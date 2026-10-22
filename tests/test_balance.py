"""밸런스 회귀 검사. 전체 규모는 slow (CI에서 balance.toml 변경 시 실행)."""

import pytest

from core.enums import Tier
from sim.economy_sim import Params, run


def test_smoke_small_economy():
    res = run(Params(n_players=30, hours=60, seed=1))
    assert res.reached("직업") == 30
    assert res.tier_income(Tier.HOBBY) < res.tier_income(Tier.JOB)


@pytest.mark.slow
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_full_economy_targets(seed):
    res = run(Params(seed=seed))
    assert res.recovery >= 0.80, f"회수율 {res.recovery:.3f}"
    assert res.reached("사업") == len(res.agents)
    assert 100 <= res.median_hours("사업") <= 160
    assert res.tier_income(Tier.HOBBY) < res.tier_income(Tier.JOB) < res.tier_income(Tier.BUSINESS)
