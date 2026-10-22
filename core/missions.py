"""임무 생성기 + 연계 이벤트. 템플릿과 이벤트는 data/missions.toml에서 읽는다.

- 상시: 템플릿마다 항상 열려 있음 (요청 시 생성)
- 의뢰: 게시판에 확률적으로 등록, 기한 있음, 빠른 완료 보너스
- 돌발: 연계 이벤트가 발생시키고, 단계 완료 시 다음 계열 임무로 이어짐
- 수집 임무 완료 시 도감 아이템 드롭
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from . import collection
from .config import BALANCE, load
from .enums import ItemKind, Line, MissionType, Rank, Tier
from .model import Item, MarketEntry, Mission, Player

_M, _EV = BALANCE["missions"], BALANCE["events"]
TIER_BASE_REWARD = {t: _M["tier_base_reward"][t.name] for t in Tier}
TYPE_MULT = {t: _M["type_mult"][t.name] for t in MissionType}
EMERGENCY_JOB_REWARD: int = _M["emergency_job_reward"]
FAST_BONUS: float = _M["fast_bonus"]
REQUEST_DEADLINE: int = _M["request_deadline"]
EMERGENCY_DEADLINE: int = _M["emergency_deadline"]
REQUEST_SPAWN_P: float = _M["request_spawn_p"]
BOARD_LIMIT_PER_LINE: int = _M["board_limit_per_line"]
QUEUE_LIMIT: int = _M["queue_limit"]
LOG_KEEP = 50
CRIME_MULT_CAP: float = _EV["crime_mult_cap"]
CRIME_PER_BUSINESS: float = _EV["crime_per_business"]
PLAYERS_PER_EVENT_UNIT: int = _EV["players_per_event_unit"]

_DATA = load("missions")


# ── 템플릿 ──────────────────────────────────────────────
@dataclass(frozen=True)
class MissionTemplate:
    id: str
    name: str
    line: Line
    tier: Tier
    type: MissionType
    min_rank: Rank | None = None
    gear: int = 0
    yield_item: str | None = None  # 채집형: 보상이 이 아이템 시세에 연동
    event_only: bool = False  # 연계 이벤트에서만 등장


def _template(d: dict[str, Any]) -> MissionTemplate:
    return MissionTemplate(
        d["id"],
        d["name"],
        Line[d["line"]],
        Tier[d["tier"]],
        MissionType[d["type"]],
        Rank[d["min_rank"]] if "min_rank" in d else None,
        d.get("gear", 0),
        d.get("yield_item"),
        d.get("event_only", False),
    )


TEMPLATES: dict[str, MissionTemplate] = {t["id"]: _template(t) for t in _DATA["template"]}
ITEMS: dict[str, Item] = {
    i["id"]: Item(i["id"], i["name"], ItemKind.RAW, i["base_price"], Line[i["line"]]) for i in _DATA["item"]
}


def default_market() -> dict[str, MarketEntry]:
    return {k: MarketEntry(item, supply=10, demand=10) for k, item in ITEMS.items()}


# ── 세계 상태 / 효과 ────────────────────────────────────
class EffectKind(Enum):
    DEMAND = "수요 배율"  # target = item id
    SPAWN_BOOST = "의뢰 등록 배율"  # target = Line
    BIZ_BONUS = "사업 매출 보너스"  # target = Line, value = G (1회)


@dataclass(frozen=True)
class Effect:
    kind: EffectKind
    target: Line | str
    value: float
    duration: int = 0  # 틱, 0 = 즉시 1회


@dataclass
class World:
    market: dict[str, MarketEntry]
    total_businesses: int = 0
    players: int = PLAYERS_PER_EVENT_UNIT
    tick: int = 0
    active: list[tuple[Effect, int]] = field(default_factory=list)
    biz_bonus: dict[Line, float] = field(default_factory=dict)

    def apply(self, eff: Effect) -> None:
        if eff.kind is EffectKind.BIZ_BONUS:
            assert isinstance(eff.target, Line)
            self.biz_bonus[eff.target] = self.biz_bonus.get(eff.target, 0) + eff.value
            return
        until = self.tick + eff.duration
        for i, (cur, cur_until) in enumerate(self.active):
            if cur == eff:  # 같은 효과는 중첩하지 않고 기간만 연장
                self.active[i] = (cur, max(cur_until, until))
                return
        if eff.kind is EffectKind.DEMAND:
            assert isinstance(eff.target, str)
            self.market[eff.target].demand *= eff.value
        self.active.append((eff, until))

    def expire(self) -> None:
        keep = []
        for eff, until in self.active:
            if self.tick < until:
                keep.append((eff, until))
            elif eff.kind is EffectKind.DEMAND:
                assert isinstance(eff.target, str)
                self.market[eff.target].demand /= eff.value
        self.active = keep

    def spawn_mult(self, line: Line) -> float:
        m = 1.0
        for eff, _ in self.active:
            if eff.kind is EffectKind.SPAWN_BOOST and eff.target == line:
                m *= eff.value
        return m

    def price_ratio(self, item_id: str) -> float:
        e = self.market[item_id]
        return e.price / e.item.base_price


# ── 연계 이벤트 ─────────────────────────────────────────
@dataclass(frozen=True)
class ChainStep:
    template_id: str
    on_start: tuple[Effect, ...] = ()
    on_done: tuple[Effect, ...] = ()


@dataclass(frozen=True)
class EventChain:
    id: str
    name: str
    base_p: float
    steps: tuple[ChainStep, ...]
    crime: bool = False

    def chance(self, world: World) -> float:
        scale = world.players / PLAYERS_PER_EVENT_UNIT
        crime = min(1 + CRIME_PER_BUSINESS * world.total_businesses, CRIME_MULT_CAP) if self.crime else 1.0
        return min(self.base_p * scale * crime, 1.0)


def _effect(d: dict[str, Any]) -> Effect:
    kind = EffectKind[d["kind"]]
    target: Line | str = d["target"] if kind is EffectKind.DEMAND else Line[d["target"]]
    return Effect(kind, target, d["value"], d.get("duration", 0))


CHAINS = [
    EventChain(
        c["id"],
        c["name"],
        c["base_p"],
        tuple(
            ChainStep(
                s["template"],
                tuple(_effect(e) for e in s.get("on_start", [])),
                tuple(_effect(e) for e in s.get("on_done", [])),
            )
            for s in c["step"]
        ),
        c.get("crime", False),
    )
    for c in _DATA["chain"]
]
CHAIN_BY_ID = {c.id: c for c in CHAINS}


@dataclass
class ChainRun:
    chain: EventChain
    step: int = 0


# ── 게시판 ──────────────────────────────────────────────
@dataclass
class Posting:
    mission: Mission
    template: MissionTemplate
    posted: int
    deadline: int | None
    chain: ChainRun | None = None
    taken_by: str | None = None  # 수락한 플레이어 (타이머 진행 중에는 만료·중복 수락 없음)


def collect_drop(rng: random.Random, player: Player, template: MissionTemplate) -> collection.Drop | None:
    """수집 임무 완료 시 도감 드롭 (확률제)"""
    if template.line is not Line.COLLECTING or rng.random() >= collection.DROP_P.get(template.type.name, 0):
        return None
    item = collection.roll(rng, player.skills[Line.COLLECTING].level, rare_find=template.type is MissionType.REQUEST)
    return collection.obtain(player, item)


@dataclass(frozen=True)
class Completion:
    reward: int
    drop: collection.Drop | None = None


class MissionBoard:
    def __init__(self, world: World, rng: random.Random | None = None):
        self.world = world
        self.rng = rng or random.Random()
        self.postings: dict[str, Posting] = {}
        self._ids = itertools.count(1)
        self.log: list[str] = []
        self.log_total = 0  # 지금까지 쌓인 로그 수 (log에는 최근 LOG_KEEP개만 보관)

    def _log(self, msg: str) -> None:
        self.log.append(msg)
        self.log_total += 1
        del self.log[:-LOG_KEEP]

    # 생성 ------------------------------------------
    def _reward(self, t: MissionTemplate) -> int:
        if t.type is MissionType.EMERGENCY and t.tier is Tier.JOB:
            return EMERGENCY_JOB_REWARD
        r = TIER_BASE_REWARD[t.tier] * TYPE_MULT[t.type]
        if t.yield_item:
            r *= self.world.price_ratio(t.yield_item)
        return round(r)

    def _post(self, t: MissionTemplate, deadline: int | None, chain: ChainRun | None = None) -> Posting:
        m = Mission(
            f"{t.id}-{next(self._ids)}",
            t.line,
            t.tier,
            t.type,
            self._reward(t),
            min_rank=t.min_rank,
            required_gear_price=t.gear,
        )
        p = Posting(m, t, self.world.tick, deadline, chain)
        self.postings[m.id] = p
        return p

    def reward_for(self, template_id: str) -> int:
        """현재 시세 기준 보상 (대기열 예약 시점에 고정)"""
        return self._reward(TEMPLATES[template_id])

    def routine(self, template_id: str) -> Posting:
        """상시 임무는 요청 시 즉석 생성 (다음 틱에 사라짐)"""
        t = TEMPLATES[template_id]
        if t.type is not MissionType.ROUTINE:
            raise ValueError(f"{t.name}은(는) 상시 임무가 아님")
        return self._post(t, None)

    def _start_step(self, run: ChainRun) -> None:
        step = run.chain.steps[run.step]
        for eff in step.on_start:
            self.world.apply(eff)
        t = TEMPLATES[step.template_id]
        limit = EMERGENCY_DEADLINE if t.type is MissionType.EMERGENCY else REQUEST_DEADLINE
        p = self._post(t, self.world.tick + limit, run)
        self._log(f"[{self.world.tick:4d}] {run.chain.name} {run.step + 1}단계: {p.template.name}")

    # 진행 ------------------------------------------
    def update(self) -> None:
        w = self.world
        w.tick += 1
        w.expire()
        for mid, p in list(self.postings.items()):
            if p.taken_by:
                continue
            if p.deadline is None:
                del self.postings[mid]
            elif w.tick > p.deadline:
                del self.postings[mid]
                if p.chain:
                    self._log(f"[{w.tick:4d}] {p.chain.chain.name} 실패: {p.template.name} 기한 초과")
        for line in Line:
            open_n = sum(
                1 for p in self.postings.values() if p.template.line == line and p.template.type is MissionType.REQUEST
            )
            if open_n < BOARD_LIMIT_PER_LINE and self.rng.random() < REQUEST_SPAWN_P * w.spawn_mult(line):
                pool = [
                    t
                    for t in TEMPLATES.values()
                    if t.line == line and t.type is MissionType.REQUEST and not t.event_only
                ]
                self._post(self.rng.choice(pool), w.tick + REQUEST_DEADLINE)
        for chain in CHAINS:
            if self.rng.random() < chain.chance(w):
                self._start_step(ChainRun(chain))

    def available(self, player: Player) -> list[Posting]:
        return [p for p in self.postings.values() if not p.taken_by and p.mission.available_to(player)]

    def accept(self, mission_id: str, player: Player) -> Posting:
        """의뢰·돌발 수락: 완료(complete)까지 이 플레이어에게 묶인다"""
        p = self.postings.get(mission_id)
        if p is None or p.deadline is None:
            raise ValueError("수락할 수 없는 임무")
        if p.taken_by:
            raise ValueError("이미 수락된 임무")
        if not p.mission.available_to(player):
            raise ValueError("조건 미충족")
        p.taken_by = player.id
        return p

    def complete(self, mission_id: str, player: Player) -> Completion:
        p = self.postings.pop(mission_id)
        if (p.taken_by and p.taken_by != player.id) or not p.mission.available_to(player):
            self.postings[mission_id] = p
            raise ValueError("조건 미충족")
        fast = p.deadline is not None and self.world.tick - p.posted <= (p.deadline - p.posted) / 2
        if p.template.type is MissionType.REQUEST and fast:
            p.mission.reward = round(p.mission.reward * (1 + FAST_BONUS))
        p.mission.complete(player)
        drop = collect_drop(self.rng, player, p.template)
        if p.chain:
            run = p.chain
            for eff in run.chain.steps[run.step].on_done:
                self.world.apply(eff)
            run.step += 1
            if run.step < len(run.chain.steps):
                self._start_step(run)
            else:
                self._log(f"[{self.world.tick:4d}] {run.chain.name} 해결")
        return Completion(p.mission.reward, drop)
