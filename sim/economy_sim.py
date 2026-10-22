"""경제 시뮬레이션: 플레이어 N명이 취미 → 직업 → 사업으로 성장하며 회수율과 계층 수입을 잰다.

1틱 = 임무 1건(3분, 활동량 기준). 사업 정산은 임무 8건당 1회
(모바일 기준: 하루 80건 플레이 · 하루 정산 10회와 같은 비율).
실행: python -m sim.economy_sim
"""

from __future__ import annotations

import random
import statistics
from collections import defaultdict
from dataclasses import dataclass, field

from core.config import BALANCE
from core.enums import Line, MissionType, Rank, Tier
from core.missions import MissionBoard, World, default_market
from core.model import (
    BUSINESS_OPEN_COST,
    BUSINESS_REVENUE,
    BUSINESS_TAX,
    DEATH_MONEY_LOSS,
    HOBBY_MEDICAL_DISCOUNT,
    JOB_BONUS_PER_H,
    MISSION_HOURS,
    MISSION_XP,
    MISSIONS_PER_DAY,
    RANK_REQ,
    REPAIR_RATE,
    SALES_TAX,
    Equipment,
    Player,
    business_upkeep,
)

_E = BALANCE["economy"]
HOBBY_REWARD: float = _E["hobby_reward"]
INJURY_P: float = _E["injury_p"]
DEATH_P: float = _E["death_p"]
REQUEST_PROB = 0.4  # 플레이어가 의뢰를 고르는 비율 (행동 가정)
GEAR_BY_RANK = {Rank.APPRENTICE: 200, Rank.EXPERT: 1_500, Rank.CHIEF: 6_000}
RISKY = {Line.HUNTING, Line.SECURITY}
MAX_BUSINESSES = 10
EVENT_TAKE_P = 0.5
YIELD_ITEMS = {Line.CONSTRUCTION: ("wood", "stone"), Line.MEDICAL: ("herb",), Line.HUNTING: ("meat", "hide")}
MILESTONES = ("직업", "REGULAR", "EXPERT", "CHIEF", "사업")


@dataclass
class Ledger:
    src: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    sink: dict[str, float] = field(default_factory=lambda: defaultdict(float))

    def earn(self, k: str, v: float) -> None:
        self.src[k] += v

    def spend(self, k: str, v: float) -> None:
        self.sink[k] += v

    @property
    def recovery(self) -> float:
        return sum(self.sink.values()) / max(sum(self.src.values()), 1e-9)


@dataclass
class Agent:
    p: Player
    line: Line
    milestones: dict[str, float] = field(default_factory=dict)
    income_by_tier: dict[Tier, list[float]] = field(default_factory=lambda: defaultdict(list))
    biz_due: float = 0.0


@dataclass
class Params:
    n_players: int = 200
    hours: float = 300
    seed: int = 1
    events: bool = True
    expand: bool = True
    biz_per_mission: float = 1 / MISSIONS_PER_DAY
    repair_rate: float = REPAIR_RATE
    biz_tax: float = BUSINESS_TAX


@dataclass
class Result:
    agents: list[Agent]
    ledger: Ledger
    board: MissionBoard | None

    @property
    def recovery(self) -> float:
        return self.ledger.recovery

    def median_hours(self, milestone: str) -> float:
        hs = [a.milestones[milestone] for a in self.agents if milestone in a.milestones]
        return statistics.median(hs) if hs else float("nan")

    def reached(self, milestone: str) -> int:
        return sum(1 for a in self.agents if milestone in a.milestones)

    def tier_income(self, tier: Tier) -> float:
        xs = [x for a in self.agents for x in a.income_by_tier[tier]]
        return sum(xs) / len(xs) if xs else float("nan")


def _tick(a: Agent, t: int, led: Ledger, rng: random.Random, prm: Params, world: World | None) -> None:
    p, line = a.p, a.line
    hours = t * MISSION_HOURS
    before = p.money
    job = p.jobs.get(line)
    mtype = MissionType.REQUEST if rng.random() < REQUEST_PROB else MissionType.ROUTINE

    # 1) 활동 수입 + 경험치
    if job is None:
        gross = HOBBY_REWARD * rng.uniform(0.7, 1.3)
        if world and line in YIELD_ITEMS:
            items = YIELD_ITEMS[line]
            gross *= sum(world.price_ratio(i) for i in items) / len(items)
        tax = gross * SALES_TAX
        p.money += gross - tax
        led.earn("취미 판매", gross)
        led.spend("판매세", tax)
        tier = Tier.HOBBY
    else:
        pay = (job.hourly_pay + JOB_BONUS_PER_H * rng.uniform(0.5, 1.5)) * MISSION_HOURS
        p.money += pay
        led.earn("직업 급여", pay)
        job.job_missions += 1
        if mtype is MissionType.REQUEST:
            job.requests_done += 1
        tier = Tier.JOB
    p.gain_xp(line, MISSION_XP[mtype])

    # 2) 위험
    if line in RISKY:
        if rng.random() < DEATH_P:
            loss = max(p.money, 0) * DEATH_MONEY_LOSS + 300
            p.money -= loss
            led.spend("사망 손실+치료", loss)
        elif rng.random() < INJURY_P:
            fee = rng.randint(50, 300) * (HOBBY_MEDICAL_DISCOUNT if job is None else 1)
            p.money -= fee
            led.spend("치료비", fee)

    # 3) 활동량 정산 (임무 8건마다 수리)
    if t % MISSIONS_PER_DAY == 0 and p.equipment:
        c = max(e.price for e in p.equipment) * prm.repair_rate
        p.money -= c
        led.spend("장비 수리", c)
    if p.businesses:
        a.biz_due += prm.biz_per_mission
        while a.biz_due >= 1:
            a.biz_due -= 1
            rev = BUSINESS_REVENUE * len(p.businesses) * rng.uniform(0.7, 1.3)
            up, tax = p.upkeep(), rev * prm.biz_tax
            p.money += rev - up - tax
            led.earn("사업 매출", rev)
            led.spend("사업 유지비", up)
            led.spend("사업 매출세", tax)

    a.income_by_tier[Tier.BUSINESS if p.businesses else tier].append((p.money - before) / MISSION_HOURS)

    # 4) 성장 결정
    if job is None and p.can_take_job(line):
        p.take_job(line)
        a.milestones["직업"] = hours
        job = p.jobs[line]
    if job:
        gear = GEAR_BY_RANK.get(job.rank)
        if gear and all(e.price != gear for e in p.equipment) and p.money >= gear:
            p.money -= gear
            p.equipment.append(Equipment(f"gear{gear}", gear))
            led.spend("장비 구매", gear)
        p.reputation = min(100, job.requests_done)  # 의뢰 1건 = 평판 1 (가정)
        if p.can_promote(line):
            r = p.promote(line)
            led.spend("자격 취득비", RANK_REQ[r].fee)
            a.milestones[r.name] = hours
        n = len(p.businesses)
        marginal = BUSINESS_REVENUE * (1 - prm.biz_tax) - (business_upkeep(n + 1) - business_upkeep(n))
        if p.can_open_business(line) and (n == 0 or (prm.expand and marginal > 0 and n < MAX_BUSINESSES)):
            p.open_business(line)
            led.spend("사업 개설", BUSINESS_OPEN_COST)
            a.milestones.setdefault("사업", hours)


def _resolve_events(agents: list[Agent], board: MissionBoard, led: Ledger, rng: random.Random) -> None:
    for posting in [x for x in board.postings.values() if x.chain]:
        if posting.mission.id not in board.postings or rng.random() > EVENT_TAKE_P:
            continue
        cands = [a for a in agents if posting.mission.available_to(a.p)]
        if cands:
            led.earn("돌발 임무", board.complete(posting.mission.id, rng.choice(cands).p).reward)


def _pay_biz_bonus(agents: list[Agent], world: World, led: Ledger) -> None:
    for line, bonus in list(world.biz_bonus.items()):
        owners = [a for a in agents if any(b.line == line for b in a.p.businesses)]
        if owners:
            for a in owners:
                a.p.money += bonus / len(owners)
            led.earn("이벤트 사업 보너스", bonus)
            del world.biz_bonus[line]


def run(prm: Params | None = None) -> Result:
    prm = prm or Params()
    rng = random.Random(prm.seed)
    led = Ledger()
    lines = [line for line in Line if line is not Line.COLLECTING]
    agents = [Agent(Player(f"p{i}"), rng.choice(lines)) for i in range(prm.n_players)]
    world = board = None
    if prm.events:
        world = World(default_market(), players=prm.n_players)
        board = MissionBoard(world, random.Random(prm.seed + 1))
    for t in range(1, int(prm.hours / MISSION_HOURS) + 1):
        if board and world:
            world.total_businesses = sum(len(a.p.businesses) for a in agents)
            board.update()
            _resolve_events(agents, board, led, rng)
            if t % MISSIONS_PER_DAY == 0:
                _pay_biz_bonus(agents, world, led)
        for a in agents:
            _tick(a, t, led, rng, prm, world)
    return Result(agents, led, board)


def report(res: Result, title: str) -> None:
    print(f"\n=== {title} ===")
    for m in MILESTONES:
        print(f"{m:8s} 도달 {res.reached(m):3d}/{len(res.agents)}명, 중앙값 {res.median_hours(m):6.1f}h")
    print(f"회수율 {res.recovery:.3f}")
    sink = sum(res.ledger.sink.values())
    for k, v in sorted(res.ledger.sink.items(), key=lambda kv: -kv[1]):
        print(f"  회수 {k:10s} {v / sink:5.1%}")
    for tier in Tier:
        print(f"{tier.name:8s} 순수입 평균 {res.tier_income(tier):6.0f} G/활동h")


if __name__ == "__main__":
    report(run(), "설계안 v3 (연계 이벤트 포함)")
