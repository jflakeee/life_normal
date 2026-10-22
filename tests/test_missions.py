import random

from core.enums import Line, MissionType, Rank, Tier
from core.missions import (
    CHAINS,
    CRIME_MULT_CAP,
    ITEMS,
    TEMPLATES,
    Effect,
    EffectKind,
    MissionBoard,
    World,
    default_market,
)
from core.model import Equipment, JobState, Player


def test_template_count():
    assert len(TEMPLATES) == 33


def test_every_job_has_an_entry_level_routine_mission():
    # 회귀: 사냥·건축 견습이 의뢰만 기다리던 문제
    for line in Line:
        if line is Line.COLLECTING:
            continue
        assert any(
            t.line == line and t.tier is Tier.JOB and t.type is MissionType.ROUTINE and t.min_rank is None
            for t in TEMPLATES.values()
        ), line


def test_chains_reference_known_data():
    for c in CHAINS:
        for s in c.steps:
            assert s.template_id in TEMPLATES
            for e in s.on_start + s.on_done:
                if e.kind is EffectKind.DEMAND:
                    assert e.target in ITEMS


def test_same_effect_does_not_stack():
    # 회귀: 폭풍이 겹쳐 목재 수요가 계속 곱해지던 문제
    w = World(default_market())
    eff = Effect(EffectKind.DEMAND, "wood", 2.5, 64)
    w.apply(eff)
    w.apply(eff)
    assert w.market["wood"].demand == 10 * 2.5
    w.tick = 1_000
    w.expire()
    assert w.market["wood"].demand == 10


def test_crime_multiplier_is_capped():
    robbery = next(c for c in CHAINS if c.crime)
    w = World(default_market(), total_businesses=10_000)
    assert robbery.chance(w) == robbery.base_p * CRIME_MULT_CAP


def test_chain_runs_to_resolution():
    w = World(default_market())
    board = MissionBoard(w, random.Random(0))
    hero = Player("hero", equipment=[Equipment("중급", 1_500)])
    for line in Line:
        if line is not Line.COLLECTING:
            hero.jobs[line] = JobState(line, Rank.EXPERT)
    board._start_step(__import__("core.missions", fromlist=["ChainRun"]).ChainRun(CHAINS[0]))
    for _ in range(len(CHAINS[0].steps)):
        posting = next(p for p in board.postings.values() if p.chain)
        board.complete(posting.mission.id, hero)
    assert board.log[-1].endswith("해결")


def test_harvest_reward_follows_price():
    w = World(default_market())
    board = MissionBoard(w, random.Random(0))
    base = board.routine("herb").mission.reward
    w.apply(Effect(EffectKind.DEMAND, "herb", 2.0, 40))
    assert board.routine("herb").mission.reward > base
