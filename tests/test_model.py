from hypothesis import given
from hypothesis import strategies as st

from core.enums import Line, Rank
from core.model import (
    MAX_LEVEL,
    PRICE_CLAMP,
    RANK_REQ,
    Item,
    ItemKind,
    JobState,
    MarketEntry,
    Player,
    Skill,
    business_upkeep,
    cumulative_xp,
)


def test_xp_curve_matches_design():
    assert cumulative_xp(5) == 1_703
    assert cumulative_xp(10) == 11_106


def test_upkeep_is_progressive():
    assert [round(business_upkeep(n)) for n in range(4)] == [0, 100, 283, 520]


@given(st.lists(st.integers(min_value=0, max_value=5_000), max_size=50))
def test_level_never_exceeds_max(gains):
    s = Skill(Line.HUNTING)
    for g in gains:
        s.add_xp(g)
        assert 1 <= s.level <= MAX_LEVEL


@given(st.floats(min_value=0.01, max_value=1e6), st.floats(min_value=0.01, max_value=1e6))
def test_price_stays_in_clamp(supply, demand):
    e = MarketEntry(Item("wood", "목재", ItemKind.RAW, 4), supply, demand)
    lo, hi = PRICE_CLAMP
    assert 4 * lo - 1e-9 <= e.price <= 4 * hi + 1e-9


@given(st.integers(min_value=0, max_value=100_000))
def test_promotion_costs_exactly_the_fee(extra):
    req = RANK_REQ[Rank.REGULAR]
    p = Player("p", money=req.fee + extra)
    p.skills[Line.HUNTING].level = req.level
    p.jobs[Line.HUNTING] = JobState(Line.HUNTING, job_missions=req.job_missions)
    before = p.money
    assert p.promote(Line.HUNTING) is Rank.REGULAR
    assert before - p.money == req.fee


def test_promote_missing_lists_every_gap():
    p = Player("p")
    p.jobs[Line.HUNTING] = JobState(Line.HUNTING)
    missing = " ".join(p.promote_missing(Line.HUNTING))
    for word in ("Lv", "자격 취득비", "직업 임무"):
        assert word in missing


def test_business_needs_chief_and_capital():
    p = Player("p", money=10**9)
    p.jobs[Line.HUNTING] = JobState(Line.HUNTING, Rank.EXPERT)
    assert not p.can_open_business(Line.HUNTING)
    p.jobs[Line.HUNTING].rank = Rank.CHIEF
    assert p.can_open_business(Line.HUNTING)
