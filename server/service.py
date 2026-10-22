"""게임 서비스: HTTP와 무관한 명령 처리층.

- 임무 타이머는 돌리지 않는다. 시작·종료 시각만 저장하고 조회·수령 때 시각을 비교한다(지연 평가)
- 마을 틱도 지연 평가: 요청이 들어올 때 지난 시간만큼 게시판을 진행시킨다
- 상태를 바꾸는 명령은 Idempotency-Key로 한 번만 처리되고, 첫 응답이 저장된다
- 돈은 반드시 ledger 기록과 함께 바뀐다
"""

from __future__ import annotations

import json
import math
import random
import secrets
import sqlite3
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from core import collection
from core.config import BALANCE
from core.enums import Line, MissionType, Tier
from core.missions import (
    QUEUE_LIMIT,
    TEMPLATES,
    MissionBoard,
    World,
    collect_drop,
    default_market,
)
from core.model import (
    BUSINESS_OPEN_COST,
    BUSINESS_REVENUE,
    BUSINESS_TAX,
    HOBBY_MEDICAL_DISCOUNT,
    MISSION_HOURS,
    MISSIONS_PER_DAY,
    SALES_TAX,
    Equipment,
    Mission,
    Player,
)
from core.serialize import player_from_dict, player_to_dict, town_from_dict, town_to_dict

from .db import Clock, Database

Json = dict[str, Any]

TICK_SECONDS = BALANCE["time"]["mission_minutes"] * 60
SETTLE_INTERVAL = 86_400 / BALANCE["time"]["business_settlements_per_day"]
SETTLE_CAP = BALANCE["time"]["business_settlements_per_day"]
MAX_CATCHUP_TICKS = 480  # 오래 비어 있던 마을은 하루치까지만 따라잡는다
TOWN_CAPACITY = 100
START_MONEY = 100
IDEMPOTENCY_TTL = 86_400
SHOP: dict[str, int] = BALANCE["shop"]
RISKY = {Line.HUNTING, Line.SECURITY}
INJURY_P: float = BALANCE["economy"]["injury_p"]
DEATH_P: float = BALANCE["economy"]["death_p"]


class GameError(Exception):
    """플레이어에게 그대로 보여 줄 수 있는 규칙 위반 (HTTP 409)"""


class Conflict(Exception):
    """낙관적 잠금 충돌"""


class SystemClock:
    def now(self) -> float:
        import time

        return time.time()


@dataclass
class Session:
    """한 트랜잭션 안에서 불러온 플레이어와 마을"""

    conn: sqlite3.Connection
    now: float
    row: sqlite3.Row
    player: Player
    town_id: int
    world: World
    board: MissionBoard
    rng: random.Random
    town_last_tick: float
    missions_done: int
    biz_last: float | None

    @property
    def pid(self) -> str:
        return self.player.id

    def ledger(self, kind: str, amount: float, ref: str | None = None) -> None:
        if amount:
            self.conn.execute(
                "INSERT INTO ledger (player_id, kind, amount, ref, created_at) VALUES (?, ?, ?, ?, ?)",
                (self.pid, kind, amount, ref, self.now),
            )

    def pay(self, kind: str, amount: float, ref: str | None = None) -> None:
        """돈을 바꾸고 기록한다 (음수 = 지출)"""
        self.player.money += amount
        self.ledger(kind, amount, ref)

    @contextmanager
    def track(self, kind: str, ref: str | None = None) -> Iterator[None]:
        """코어 함수가 직접 바꾼 돈의 변화를 기록한다"""
        before = self.player.money
        yield
        self.ledger(kind, self.player.money - before, ref)


def _line(name: str) -> Line:
    try:
        return Line[name.upper()]
    except KeyError:
        raise GameError(f"알 수 없는 계열: {name}") from None


class GameService:
    def __init__(self, db: Database, clock: Clock | None = None):
        self.db = db
        self.clock = clock or SystemClock()

    # ── 계정 ─────────────────────────────────────────
    def create_guest(self) -> Json:
        with self.db.tx() as conn:
            now = self.clock.now()
            town = conn.execute(
                "SELECT id FROM towns WHERE player_count < ? ORDER BY id LIMIT 1", (TOWN_CAPACITY,)
            ).fetchone()
            if town is None:
                world = World(default_market())
                rng = random.Random(secrets.randbits(64))
                board = MissionBoard(world, rng)
                cur = conn.execute(
                    "INSERT INTO towns (state, last_tick_at) VALUES (?, ?)",
                    (json.dumps(town_to_dict(world, board, rng)), now),
                )
                town_id = cur.lastrowid
            else:
                town_id = town["id"]
            pid, token = uuid.uuid4().hex, secrets.token_urlsafe(32)
            p = Player(pid, money=START_MONEY)
            conn.execute(
                "INSERT INTO players (id, token, town_id, state, created_at) VALUES (?, ?, ?, ?, ?)",
                (pid, token, town_id, json.dumps(player_to_dict(p)), now),
            )
            conn.execute("UPDATE towns SET player_count = player_count + 1 WHERE id = ?", (town_id,))
            conn.execute(
                "INSERT INTO ledger (player_id, kind, amount, ref, created_at) VALUES (?, 'grant', ?, 'start', ?)",
                (pid, START_MONEY, now),
            )
            return {"player_id": pid, "token": token, "town_id": town_id}

    def player_for_token(self, token: str) -> str | None:
        row = self.db.conn.execute("SELECT id FROM players WHERE token = ?", (token,)).fetchone()
        return row["id"] if row else None

    # ── 실행 틀 ──────────────────────────────────────
    def query(self, pid: str, fn: Callable[[Session], Json]) -> Json:
        """조회도 마을 틱을 진행시키므로 트랜잭션 안에서 실행한다"""
        with self.db.tx() as conn:
            s = self._load(conn, pid)
            result = fn(s)
            self._save(s)
            return result

    def command(self, pid: str, key: str, fn: Callable[[Session], Json]) -> tuple[Json, bool]:
        """(응답, 재전송 여부). 같은 키의 두 번째 요청은 저장된 첫 응답을 돌려준다."""
        with self.db.tx() as conn:
            row = conn.execute(
                "SELECT response FROM idempotency_keys WHERE key = ? AND player_id = ?", (key, pid)
            ).fetchone()
            if row:
                return json.loads(row["response"]), True
            s = self._load(conn, pid)
            result = fn(s)
            self._save(s)
            conn.execute(
                "INSERT INTO idempotency_keys (key, player_id, response, created_at) VALUES (?, ?, ?, ?)",
                (key, pid, json.dumps(result, ensure_ascii=False), s.now),
            )
            conn.execute("DELETE FROM idempotency_keys WHERE created_at < ?", (s.now - IDEMPOTENCY_TTL,))
            return result, False

    def _load(self, conn: sqlite3.Connection, pid: str) -> Session:
        row = conn.execute("SELECT * FROM players WHERE id = ?", (pid,)).fetchone()
        if row is None:
            raise GameError("플레이어 없음")
        town = conn.execute("SELECT * FROM towns WHERE id = ?", (row["town_id"],)).fetchone()
        world, board, rng = town_from_dict(json.loads(town["state"]))
        world.players = town["player_count"]
        world.total_businesses = town["businesses"]
        s = Session(
            conn, self.clock.now(), row, player_from_dict(json.loads(row["state"])), town["id"],
            world, board, rng, town["last_tick_at"], row["missions_done"], row["biz_last_settled_at"],
        )  # fmt: skip
        self._advance_town(s)
        return s

    def _save(self, s: Session) -> None:
        cur = s.conn.execute(
            "UPDATE players SET state = ?, version = version + 1, missions_done = ?, biz_last_settled_at = ? "
            "WHERE id = ? AND version = ?",
            (json.dumps(player_to_dict(s.player)), s.missions_done, s.biz_last, s.pid, s.row["version"]),
        )
        if cur.rowcount != 1:
            raise Conflict(s.pid)
        s.conn.execute(
            "UPDATE towns SET state = ?, last_tick_at = ? WHERE id = ?",
            (json.dumps(town_to_dict(s.world, s.board, s.rng)), s.town_last_tick, s.town_id),
        )

    def _advance_town(self, s: Session) -> None:
        n = int((s.now - s.town_last_tick) // TICK_SECONDS)
        for _ in range(min(n, MAX_CATCHUP_TICKS)):
            s.board.update()
        s.town_last_tick += n * TICK_SECONDS

    # ── 조회 ─────────────────────────────────────────
    def _open_runs(self, s: Session) -> list[sqlite3.Row]:
        return s.conn.execute(
            "SELECT * FROM mission_runs WHERE player_id = ? AND claimed_at IS NULL ORDER BY ends_at, id", (s.pid,)
        ).fetchall()

    def _pending_settlements(self, s: Session) -> int:
        if not s.player.businesses or s.biz_last is None:
            return 0
        return min(SETTLE_CAP, int((s.now - s.biz_last) // SETTLE_INTERVAL))

    def state(self, s: Session) -> Json:
        p = s.player
        runs = [
            {
                "id": r["id"],
                "template": r["template_id"],
                "name": TEMPLATES[r["template_id"]].name,
                "source": r["source"],
                "reward": r["reward"],
                "ends_at": r["ends_at"],
                "done": r["ends_at"] <= s.now,
            }
            for r in self._open_runs(s)
        ]
        return {
            "now": s.now,
            "money": round(p.money, 2),
            "reputation": p.reputation,
            "skills": {line.name: {"level": sk.level, "xp": sk.xp} for line, sk in p.skills.items()},
            "jobs": {
                line.name: {
                    "rank": j.rank.name,
                    "job_missions": j.job_missions,
                    "requests_done": j.requests_done,
                    "missing": p.promote_missing(line),
                }
                for line, j in p.jobs.items()
            },
            "equipment": [e.name for e in p.equipment],
            "businesses": [b.line.name for b in p.businesses],
            "pending_settlements": self._pending_settlements(s),
            "queue": runs,
            "claimable": sum(1 for r in runs if r["done"]),
            "town_tick": s.world.tick,
        }

    def board(self, s: Session) -> Json:
        out = []
        for x in s.board.postings.values():
            if x.deadline is None or (x.taken_by and x.taken_by != s.pid):
                continue
            out.append(
                {
                    "id": x.mission.id,
                    "name": x.template.name,
                    "line": x.template.line.name,
                    "type": x.template.type.name,
                    "reward": x.mission.reward,
                    "deadline_ticks": x.deadline - s.world.tick,
                    "chain": x.chain.chain.name if x.chain else None,
                    "available": x.mission.available_to(s.player),
                    "accepted": x.taken_by == s.pid,
                }
            )
        out.sort(key=lambda d: (d["chain"] is None, d["deadline_ticks"]))  # 연계 이벤트를 맨 위에
        return {"postings": out, "events": s.board.log[-10:]}

    def notifications(self, s: Session, cursor: Json) -> list[Json]:
        """WebSocket 알림: cursor(연결별 상태)를 갱신하며 그 사이 생긴 일을 돌려준다"""
        events: list[Json] = []
        since = cursor.setdefault("checked_at", s.now)
        done = s.conn.execute(
            "SELECT COUNT(*) AS n FROM mission_runs WHERE player_id = ? AND claimed_at IS NULL "
            "AND ends_at > ? AND ends_at <= ?",
            (s.pid, since, s.now),
        ).fetchone()["n"]
        if done:
            running = s.conn.execute(
                "SELECT COUNT(*) AS n FROM mission_runs WHERE player_id = ? AND claimed_at IS NULL AND ends_at > ?",
                (s.pid, s.now),
            ).fetchone()["n"]
            events.append({"type": "mission.done", "count": done, "queue_empty": running == 0})
        seen = cursor.setdefault("log_total", s.board.log_total)
        new = s.board.log_total - seen
        for line in s.board.log[-new:] if new > 0 else []:
            text = line.split("] ", 1)[1]
            kind = "event.started" if "1단계" in text else "event.step"
            events.append({"type": kind, "text": text})
        prices = {k: round(e.price, 2) for k, e in s.world.market.items()}
        if cursor.setdefault("prices", prices) != prices:
            events.append({"type": "market.changed", "prices": prices})
        full = self._pending_settlements(s) >= SETTLE_CAP
        if full and not cursor.get("settlement_full"):
            events.append({"type": "settlement.ready"})
        cursor.update(checked_at=s.now, log_total=s.board.log_total, prices=prices, settlement_full=full)
        return events

    def catalog(self) -> Json:
        """클라이언트가 처음 한 번 받는 정적 데이터"""
        return {
            "lines": {line.name: line.value for line in Line},
            "templates": [
                {
                    "id": t.id,
                    "name": t.name,
                    "line": t.line.name,
                    "tier": t.tier.name,
                    "type": t.type.name,
                    "min_rank": t.min_rank.name if t.min_rank else None,
                    "gear": t.gear,
                }
                for t in TEMPLATES.values()
                if not t.event_only
            ],
            "shop": SHOP,
            "repair_rate": BALANCE["economy"]["repair_rate"],
            "queue_limit": QUEUE_LIMIT,
            "mission_seconds": TICK_SECONDS,
            "business": {
                "open_cost": BUSINESS_OPEN_COST,
                "revenue": BUSINESS_REVENUE,
                "tax": BUSINESS_TAX,
                "settlements_per_day": SETTLE_CAP,
            },
        }

    def market(self, s: Session) -> Json:
        return {
            k: {"name": e.item.name, "base": e.item.base_price, "price": round(e.price, 2)}
            for k, e in s.world.market.items()
        }

    def collection(self, s: Session) -> Json:
        return {
            line.name: {"owned": owned, "total": total, "xp_mult": round(mult, 2)}
            for line, owned, total, mult in collection.progress(s.player.collection)
        }

    # ── 임무 ─────────────────────────────────────────
    def enqueue(self, s: Session, template_id: str, count: int) -> Json:
        t = TEMPLATES.get(template_id)
        if t is None or t.type is not MissionType.ROUTINE:
            raise GameError("대기열에는 상시 임무만 넣을 수 있습니다")
        probe = Mission("probe", t.line, t.tier, t.type, 0, t.min_rank, t.gear)
        if not probe.available_to(s.player):
            raise GameError("조건 미충족 (직업 또는 장비)")
        queued = [r for r in self._open_runs(s) if r["source"] == "queue"]
        if len(queued) + count > QUEUE_LIMIT:
            raise GameError(f"대기열은 최대 {QUEUE_LIMIT}건 (받지 않은 완료 포함)")
        start = max([s.now] + [r["ends_at"] for r in queued])
        reward = s.board.reward_for(template_id)
        ids = []
        for _ in range(count):
            cur = s.conn.execute(
                "INSERT INTO mission_runs (player_id, template_id, source, reward, started_at, ends_at) "
                "VALUES (?, ?, 'queue', ?, ?, ?)",
                (s.pid, template_id, reward, start, start + TICK_SECONDS),
            )
            ids.append(cur.lastrowid)
            start += TICK_SECONDS
        return {"queued": ids, "reward_each": reward, "queue_ends_at": start}

    def cancel(self, s: Session, run_id: int) -> Json:
        r = s.conn.execute(
            "SELECT * FROM mission_runs WHERE id = ? AND player_id = ? AND claimed_at IS NULL", (run_id, s.pid)
        ).fetchone()
        if r is None or r["source"] != "queue" or r["started_at"] <= s.now:
            raise GameError("시작 전인 대기열 임무만 취소할 수 있습니다")
        s.conn.execute("DELETE FROM mission_runs WHERE id = ?", (run_id,))
        later = s.conn.execute(
            "SELECT id FROM mission_runs WHERE player_id = ? AND source = 'queue' AND claimed_at IS NULL "
            "AND started_at > ? ORDER BY started_at",
            (s.pid, r["started_at"]),
        ).fetchall()
        for row in later:  # 뒤의 임무를 앞으로 당긴다
            s.conn.execute(
                "UPDATE mission_runs SET started_at = started_at - ?, ends_at = ends_at - ? WHERE id = ?",
                (TICK_SECONDS, TICK_SECONDS, row["id"]),
            )
        return {"cancelled": run_id}

    def accept(self, s: Session, posting_id: str) -> Json:
        if any(r["source"] == "board" for r in self._open_runs(s)):
            raise GameError("의뢰·돌발은 한 번에 하나만 진행할 수 있습니다")
        try:
            x = s.board.accept(posting_id, s.player)
        except ValueError as e:
            raise GameError(str(e)) from None
        cur = s.conn.execute(
            "INSERT INTO mission_runs (player_id, template_id, source, posting_id, reward, started_at, ends_at) "
            "VALUES (?, ?, 'board', ?, ?, ?, ?)",
            (s.pid, x.template.id, posting_id, x.mission.reward, s.now, s.now + TICK_SECONDS),
        )
        return {"run_id": cur.lastrowid, "ends_at": s.now + TICK_SECONDS}

    def claim(self, s: Session) -> Json:
        p, results = s.player, []
        for r in self._open_runs(s):
            if r["ends_at"] > s.now:
                continue
            t = TEMPLATES[r["template_id"]]
            ref = f"run:{r['id']}"
            rng = random.Random(f"{s.pid}:{r['id']}")
            before = p.money
            if r["source"] == "board":
                if r["posting_id"] not in s.board.postings:
                    s.conn.execute("UPDATE mission_runs SET claimed_at = ? WHERE id = ?", (s.now, r["id"]))
                    results.append({"run": r["id"], "name": t.name, "expired": True})
                    continue
                drop = s.board.complete(r["posting_id"], p).drop
            else:
                Mission(ref, t.line, t.tier, t.type, r["reward"], t.min_rank, t.gear).complete(p)
                drop = collect_drop(rng, p, t)
            sold = drop.sold_for if drop else 0
            gained = p.money - before - sold  # 의뢰 빠른 완료 보너스 포함
            s.ledger("mission_reward", gained, ref)
            s.ledger("collection_sale", sold, ref)
            item: Json = {"run": r["id"], "name": t.name, "reward": gained}
            if t.tier is Tier.HOBBY:
                s.pay("sales_tax", -gained * SALES_TAX, ref)
            elif t.tier is Tier.JOB:
                pay = p.jobs[t.line].hourly_pay * MISSION_HOURS
                s.pay("job_pay", pay, ref)
                item["pay"] = round(pay, 2)
            if drop:
                item["drop"] = {"name": drop.item.name, "registered": drop.registered, "sold_for": sold}
            item.update(self._risk(s, rng, t.line, hobby=t.tier is Tier.HOBBY, ref=ref))
            s.missions_done += 1
            if s.missions_done % MISSIONS_PER_DAY == 0 and p.equipment:
                s.pay("repair", -max(e.repair_cost() for e in p.equipment), ref)
            s.conn.execute("UPDATE mission_runs SET claimed_at = ? WHERE id = ?", (s.now, r["id"]))
            results.append(item)
        p.reputation = min(100, sum(j.requests_done for j in p.jobs.values()))
        return {"claimed": results, "money": round(p.money, 2)}

    def _risk(self, s: Session, rng: random.Random, line: Line, hobby: bool, ref: str) -> Json:
        if line not in RISKY:
            return {}
        if rng.random() < DEATH_P:
            with s.track("death", ref):
                s.player.on_death()
            return {"incident": "death"}
        if rng.random() < INJURY_P:
            fee = rng.randint(50, 300) * (HOBBY_MEDICAL_DISCOUNT if hobby else 1)
            s.pay("medical", -fee, ref)
            return {"incident": "injury", "medical_fee": fee}
        return {}

    # ── 성장 ─────────────────────────────────────────
    def take_job(self, s: Session, line_name: str) -> Json:
        line = _line(line_name)
        try:
            s.player.take_job(line)
        except ValueError as e:
            raise GameError(str(e)) from None
        return {"job": line.name, "rank": s.player.jobs[line].rank.name}

    def promote(self, s: Session, line_name: str) -> Json:
        line = _line(line_name)
        try:
            with s.track("rank_fee", line.name):
                rank = s.player.promote(line)
        except ValueError as e:
            raise GameError(str(e)) from None
        return {"job": line.name, "rank": rank.name}

    def buy(self, s: Session, item: str) -> Json:
        price = SHOP.get(item)
        if price is None:
            raise GameError("없는 상품")
        if s.player.money < price:
            raise GameError(f"돈이 부족합니다 ({price:,} G)")
        s.pay("shop", -price, item)
        s.player.equipment.append(Equipment(item, price))
        return {"bought": item, "money": round(s.player.money, 2)}

    # ── 사업 ─────────────────────────────────────────
    def open_business(self, s: Session, line_name: str) -> Json:
        line = _line(line_name)
        if not s.player.can_open_business(line):
            raise GameError("책임 직급과 자본이 필요합니다")
        if s.player.businesses:
            self.collect(s)  # 사업 수가 바뀌기 전에 밀린 정산부터
        with s.track("business_open", line.name):
            s.player.open_business(line)
        if s.biz_last is None:
            s.biz_last = s.now
        s.conn.execute("UPDATE towns SET businesses = businesses + 1 WHERE id = ?", (s.town_id,))
        return {"businesses": [b.line.name for b in s.player.businesses]}

    def collect(self, s: Session) -> Json:
        pending = self._pending_settlements(s)
        if not pending or s.biz_last is None:
            return {"settled": 0}
        p, n = s.player, len(s.player.businesses)
        rng = random.Random(f"{s.pid}:biz:{s.biz_last}")
        total = 0.0
        for _ in range(pending):
            rev = BUSINESS_REVENUE * n * rng.uniform(0.7, 1.3)
            s.pay("business_revenue", rev)
            s.pay("business_tax", -rev * BUSINESS_TAX)
            s.pay("business_upkeep", -p.upkeep())
            total += rev * (1 - BUSINESS_TAX) - p.upkeep()
        for line in {b.line for b in p.businesses}:
            bonus = s.world.biz_bonus.pop(line, 0)
            s.pay("event_bonus", bonus, line.name)
            total += bonus
        elapsed = s.now - s.biz_last
        capped = elapsed >= SETTLE_CAP * SETTLE_INTERVAL
        s.biz_last = s.now if capped else s.biz_last + pending * SETTLE_INTERVAL
        return {"settled": pending, "net": round(total, 2), "money": round(p.money, 2)}


# ── 운영 점검 ───────────────────────────────────────────
def audit(db: Database) -> list[Json]:
    """ledger 합계와 실제 돈이 어긋난 플레이어 목록 (야간 점검)"""
    bad = []
    rows = db.conn.execute(
        "SELECT p.id, p.state, COALESCE(SUM(l.amount), 0) AS total "
        "FROM players p LEFT JOIN ledger l ON l.player_id = p.id GROUP BY p.id"
    ).fetchall()
    for r in rows:
        money = json.loads(r["state"])["money"]
        if not math.isclose(money, r["total"], abs_tol=1e-6):
            bad.append({"player": r["id"], "money": money, "ledger": r["total"]})
    return bad


def economy_report(db: Database) -> Json:
    """마을 전체 회수율: 지출 합 / 수입 합 (초기 지급 제외)"""
    rows = db.conn.execute(
        "SELECT kind, SUM(amount) AS total FROM ledger WHERE kind != 'grant' GROUP BY kind"
    ).fetchall()
    src = {r["kind"]: r["total"] for r in rows if r["total"] > 0}
    sink = {r["kind"]: -r["total"] for r in rows if r["total"] < 0}
    s_in, s_out = sum(src.values()), sum(sink.values())
    return {"inflow": src, "outflow": sink, "recovery": round(s_out / s_in, 3) if s_in else None}
