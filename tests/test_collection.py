import random

from core import collection
from core.enums import Line
from core.missions import MissionBoard, World, default_market
from core.model import Player


def test_full_line_gives_max_bonus():
    owned = {c.id for c in collection.CATALOG.values() if c.line is Line.HUNTING}
    assert collection.xp_mult(owned, Line.HUNTING) == 1 + 0.02 * 5 + 0.10


def test_duplicate_is_sold_not_registered():
    p = Player("p")
    item = next(iter(collection.CATALOG.values()))
    assert collection.obtain(p, item).registered
    d = collection.obtain(p, item)
    assert not d.registered and p.money == d.sold_for > 0


def test_xp_bonus_applies_to_missions():
    p = Player("p")
    p.collection = {c.id for c in collection.CATALOG.values() if c.line is Line.HUNTING}
    p.gain_xp(Line.HUNTING, 50)
    assert p.skills[Line.HUNTING].xp == 60


def test_collecting_income_matches_other_hobbies():
    # 회귀: 중복 판매로 수집 취미가 시간당 약 350 G를 벌던 문제. 목표: 기본 취미(100 G/h)의 1.3배 이하
    b = MissionBoard(World(default_market()), random.Random(1))
    p = Player("p")
    n = 2_000
    for _ in range(n):
        b.update()
        b.complete(b.routine("specimen").mission.id, p)
    assert p.money / n * 20 <= 130
