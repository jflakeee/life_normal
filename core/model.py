"""데이터 모델과 규칙. 수치는 data/balance.toml에서 읽는다."""

from __future__ import annotations

from dataclasses import dataclass, field

from .config import BALANCE as B
from .enums import ItemKind, Line, MissionType, Rank, Tier

# ── 밸런스 상수 ─────────────────────────────────────────
_P, _E, _BZ = B["progression"], B["economy"], B["business"]
MAX_LEVEL: int = _P["max_level"]
JOB_UNLOCK_LEVEL: int = _P["job_unlock_level"]
MISSION_XP = {t: B["mission_xp"][t.name] for t in MissionType}
JOB_BASE_PAY: float = B["job"]["base_pay_per_hour"]
JOB_BONUS_PER_H: float = B["job"]["bonus_per_hour"]
RANK_PAY_MULT = {r: B["job"]["pay_mult"][r.name] for r in Rank}

MISSIONS_PER_DAY: int = B["time"]["missions_per_game_day"]
MISSION_HOURS: float = B["time"]["mission_minutes"] / 60
SALES_TAX: float = _E["sales_tax"]
NPC_BUY_RATIO: float = _E["npc_buy_ratio"]
PRICE_SENSITIVITY: float = _E["price_sensitivity"]
PRICE_CLAMP: tuple[float, float] = tuple(_E["price_clamp"])  # type: ignore[assignment]
REPAIR_RATE: float = _E["repair_rate"]
DEATH_MONEY_LOSS: float = _E["death_money_loss"]
DEATH_MEDICAL_FEE: int = _E["death_medical_fee"]
DEATH_DURABILITY_LOSS: float = _E["death_durability_loss"]
HOBBY_MEDICAL_DISCOUNT: float = _E["hobby_medical_discount"]

BUSINESS_OPEN_COST: int = _BZ["open_cost"]
BUSINESS_REVENUE: float = _BZ["revenue_per_settlement"]
BUSINESS_UPKEEP_BASE: float = _BZ["upkeep_base"]
BUSINESS_UPKEEP_EXP: float = _BZ["upkeep_exponent"]
BUSINESS_TAX: float = _BZ["tax"]


@dataclass(frozen=True)
class RankRequirement:
    level: int
    fee: int
    job_missions: int = 0
    requests_done: int = 0
    reputation: int = 0


RANK_REQ = {Rank[k]: RankRequirement(**v) for k, v in B["rank_req"].items()}


def xp_to_next(level: int) -> int:
    """Lv L → L+1 필요 경험치"""
    return round(_P["xp_base"] * level ** _P["xp_exponent"])


def cumulative_xp(level: int) -> int:
    return sum(xp_to_next(lv) for lv in range(1, level))


def business_upkeep(n: int) -> float:
    """사업 n개의 정산 1회당 유지비 총액 (누진)"""
    return BUSINESS_UPKEEP_BASE * n**BUSINESS_UPKEEP_EXP if n else 0.0


# ── 아이템 / 시장 ───────────────────────────────────────
@dataclass(frozen=True)
class Item:
    id: str
    name: str
    kind: ItemKind
    base_price: int
    line: Line | None = None


@dataclass
class MarketEntry:
    item: Item
    supply: float = 1.0
    demand: float = 1.0

    @property
    def price(self) -> float:
        ratio = 1 + PRICE_SENSITIVITY * (self.demand - self.supply) / max(self.supply, 1e-9)
        lo, hi = PRICE_CLAMP
        return self.item.base_price * min(max(ratio, lo), hi)

    @property
    def npc_floor(self) -> float:
        return self.item.base_price * NPC_BUY_RATIO


# ── 진행도 ──────────────────────────────────────────────
@dataclass
class Skill:
    line: Line
    level: int = 1
    xp: int = 0

    def add_xp(self, amount: int) -> int:
        """경험치 추가 후 오른 레벨 수 반환"""
        gained = 0
        self.xp += amount
        while self.level < MAX_LEVEL and self.xp >= xp_to_next(self.level):
            self.xp -= xp_to_next(self.level)
            self.level += 1
            gained += 1
        if self.level == MAX_LEVEL:
            self.xp = 0
        return gained


@dataclass
class JobState:
    line: Line
    rank: Rank = Rank.APPRENTICE
    job_missions: int = 0
    requests_done: int = 0

    @property
    def hourly_pay(self) -> float:
        return JOB_BASE_PAY * RANK_PAY_MULT[self.rank]


@dataclass
class Equipment:
    name: str
    price: int
    durability: float = 1.0

    def repair_cost(self) -> float:
        """임무 8건마다 청구"""
        return self.price * REPAIR_RATE


@dataclass
class Business:
    line: Line
    owner_id: str
    employees: list[str] = field(default_factory=list)
    revenue_per_day: float = 0.0


@dataclass
class Player:
    id: str
    money: float = 0
    reputation: int = 0
    skills: dict[Line, Skill] = field(default_factory=lambda: {line: Skill(line) for line in Line})
    jobs: dict[Line, JobState] = field(default_factory=dict)
    businesses: list[Business] = field(default_factory=list)
    equipment: list[Equipment] = field(default_factory=list)
    collection: set[str] = field(default_factory=set)

    # 성장 보너스 -------------------------------------
    def xp_mult(self, line: Line) -> float:
        from .collection import xp_mult  # 순환 import 방지

        return xp_mult(self.collection, line)

    def gain_xp(self, line: Line, base: int) -> int:
        return self.skills[line].add_xp(round(base * self.xp_mult(line)))

    # 계층 승급 ----------------------------------------
    def can_take_job(self, line: Line) -> bool:
        return line is not Line.COLLECTING and self.skills[line].level >= JOB_UNLOCK_LEVEL

    def take_job(self, line: Line) -> None:
        if not self.can_take_job(line):
            raise ValueError(f"{line.value}: 취미 Lv {JOB_UNLOCK_LEVEL} 필요")
        self.jobs.setdefault(line, JobState(line))

    def promote_missing(self, line: Line) -> list[str]:
        """승급에 부족한 조건 목록 (비어 있으면 승급 가능)"""
        job = self.jobs.get(line)
        if job is None:
            return ["직업 없음"]
        if job.rank == Rank.CHIEF:
            return ["최고 직급"]
        req = RANK_REQ[Rank(job.rank + 1)]
        checks = [
            (self.skills[line].level, req.level, "Lv"),
            (self.money, req.fee, "자격 취득비 G"),
            (job.job_missions, req.job_missions, "직업 임무"),
            (job.requests_done, req.requests_done, "의뢰 완료"),
            (self.reputation, req.reputation, "평판"),
        ]
        return [f"{name} {have:g}/{need}" for have, need, name in checks if have < need]

    def can_promote(self, line: Line) -> bool:
        return not self.promote_missing(line)

    def promote(self, line: Line) -> Rank:
        missing = self.promote_missing(line)
        if missing:
            raise ValueError("승급 조건 부족: " + ", ".join(missing))
        job = self.jobs[line]
        new_rank = Rank(job.rank + 1)
        self.money -= RANK_REQ[new_rank].fee
        job.rank = new_rank
        return new_rank

    def can_open_business(self, line: Line) -> bool:
        job = self.jobs.get(line)
        return job is not None and job.rank == Rank.CHIEF and self.money >= BUSINESS_OPEN_COST

    def open_business(self, line: Line) -> Business:
        if not self.can_open_business(line):
            raise ValueError("책임 직급 + 자본 필요")
        self.money -= BUSINESS_OPEN_COST
        biz = Business(line, self.id)
        self.businesses.append(biz)
        return biz

    # 경제 -------------------------------------------
    def upkeep(self) -> float:
        return business_upkeep(len(self.businesses))

    def sell(self, entry: MarketEntry, qty: int) -> float:
        gross = max(entry.price, entry.npc_floor) * qty
        net = gross * (1 - SALES_TAX)
        self.money += net
        entry.supply += qty
        return net

    def on_death(self) -> float:
        loss = max(self.money, 0) * DEATH_MONEY_LOSS + DEATH_MEDICAL_FEE
        self.money -= loss
        for eq in self.equipment:
            eq.durability = max(0.0, eq.durability - DEATH_DURABILITY_LOSS)
        return loss


# ── 임무 인스턴스 ───────────────────────────────────────
@dataclass
class Mission:
    id: str
    line: Line
    tier: Tier
    type: MissionType
    reward: int
    min_rank: Rank | None = None
    required_gear_price: int = 0

    def available_to(self, p: Player) -> bool:
        if self.tier == Tier.JOB:
            job = p.jobs.get(self.line)
            if job is None or (self.min_rank and job.rank < self.min_rank):
                return False
        if self.tier == Tier.BUSINESS and not any(b.line == self.line for b in p.businesses):
            return False
        return self.required_gear_price == 0 or any(e.price >= self.required_gear_price for e in p.equipment)

    def complete(self, p: Player) -> None:
        p.money += self.reward
        p.gain_xp(self.line, MISSION_XP[self.type])
        if self.tier == Tier.JOB:
            job = p.jobs[self.line]
            job.job_missions += 1
            if self.type == MissionType.REQUEST:
                job.requests_done += 1
