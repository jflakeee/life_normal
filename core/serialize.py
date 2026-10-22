"""플레이어·마을(세계+게시판+난수) 직렬화. CLI 세이브와 서버 DB가 함께 쓴다."""

from __future__ import annotations

import itertools
import random
from typing import Any

from .enums import Line, Rank
from .missions import CHAIN_BY_ID, TEMPLATES, ChainRun, Effect, EffectKind, MissionBoard, Posting, World, default_market
from .model import Business, Equipment, JobState, Mission, Player, Skill

Json = dict[str, Any]


# ── 플레이어 ────────────────────────────────────────────
def player_to_dict(p: Player) -> Json:
    return {
        "id": p.id,
        "money": p.money,
        "reputation": p.reputation,
        "skills": {line.name: [s.level, s.xp] for line, s in p.skills.items()},
        "jobs": {line.name: [j.rank.name, j.job_missions, j.requests_done] for line, j in p.jobs.items()},
        "businesses": [[b.line.name, b.employees, b.revenue_per_day] for b in p.businesses],
        "equipment": [[e.name, e.price, e.durability] for e in p.equipment],
        "collection": sorted(p.collection),
    }


def player_from_dict(d: Json) -> Player:
    p = Player(d["id"], money=d["money"], reputation=d["reputation"])
    for name, (lv, xp) in d["skills"].items():
        p.skills[Line[name]] = Skill(Line[name], lv, xp)
    for name, (rank, missions, reqs) in d["jobs"].items():
        p.jobs[Line[name]] = JobState(Line[name], Rank[rank], missions, reqs)
    p.businesses = [Business(Line[b], p.id, list(emp), rev) for b, emp, rev in d["businesses"]]
    p.equipment = [Equipment(n, pr, dur) for n, pr, dur in d["equipment"]]
    p.collection = set(d["collection"])
    return p


# ── 마을: 세계 + 게시판 + 난수 ──────────────────────────
def _target(t: Line | str) -> Json:
    return {"line": t.name} if isinstance(t, Line) else {"item": t}


def _untarget(d: Json) -> Line | str:
    return Line[d["line"]] if "line" in d else d["item"]


def _next_id(board: MissionBoard) -> int:
    # itertools.count는 현재 값을 읽을 수 없으므로 한 번 꺼내고 같은 위치로 되돌린다
    n = next(board._ids)
    board._ids = itertools.count(n)
    return n


def posting_to_dict(x: Posting) -> Json:
    return {
        "id": x.mission.id,
        "template": x.template.id,
        "reward": x.mission.reward,
        "posted": x.posted,
        "deadline": x.deadline,
        "chain": [x.chain.chain.id, x.chain.step] if x.chain else None,
        "taken_by": x.taken_by,
    }


def posting_from_dict(d: Json) -> Posting:
    t = TEMPLATES[d["template"]]
    m = Mission(d["id"], t.line, t.tier, t.type, d["reward"], min_rank=t.min_rank, required_gear_price=t.gear)
    chain = ChainRun(CHAIN_BY_ID[d["chain"][0]], d["chain"][1]) if d["chain"] else None
    return Posting(m, t, d["posted"], d["deadline"], chain, d.get("taken_by"))


def town_to_dict(world: World, board: MissionBoard, rng: random.Random) -> Json:
    state = rng.getstate()
    return {
        "world": {
            "tick": world.tick,
            "players": world.players,
            "total_businesses": world.total_businesses,
            "market": {k: [e.supply, e.demand] for k, e in world.market.items()},
            "active": [[e.kind.name, _target(e.target), e.value, e.duration, until] for e, until in world.active],
            "biz_bonus": {line.name: v for line, v in world.biz_bonus.items()},
        },
        "board": {
            "postings": [posting_to_dict(x) for x in board.postings.values()],
            "next_id": _next_id(board),
            "log": board.log,
            "log_total": board.log_total,
        },
        "rng": [state[0], list(state[1]), state[2]],
    }


def town_from_dict(d: Json) -> tuple[World, MissionBoard, random.Random]:
    rng = random.Random()
    rng.setstate((d["rng"][0], tuple(d["rng"][1]), d["rng"][2]))
    wd = d["world"]
    world = World(default_market(), wd["total_businesses"], wd["players"], wd["tick"])
    for k, (supply, demand) in wd["market"].items():
        world.market[k].supply, world.market[k].demand = supply, demand
    world.active = [(Effect(EffectKind[k], _untarget(t), v, dur), until) for k, t, v, dur, until in wd["active"]]
    world.biz_bonus = {Line[k]: v for k, v in wd["biz_bonus"].items()}
    board = MissionBoard(world, rng)
    bd = d["board"]
    board.postings = {x["id"]: posting_from_dict(x) for x in bd["postings"]}
    board._ids = itertools.count(bd["next_id"])
    board.log = list(bd["log"])
    board.log_total = bd.get("log_total", len(board.log))
    return world, board, rng
