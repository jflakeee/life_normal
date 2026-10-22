"""수집 도감. 첫 획득은 도감 등록(귀속), 중복은 즉시 판매.
보너스: 등록 1개당 해당 계열 경험치 +2%, 계열 완성 시 +10% 추가."""

from __future__ import annotations

import random
from dataclasses import dataclass

from .config import BALANCE, load
from .enums import Line, Rarity

_C = BALANCE["collection"]
RARITY_WEIGHT = {r: _C["rarity_weight"][r.name] for r in Rarity}
DUPLICATE_PRICE = {r: _C["duplicate_price"][r.name] for r in Rarity}
RARE_FIND_BOOST: float = _C["rare_find_boost"]
LEVEL_BOOST_PER_LV: float = _C["level_boost_per_lv"]
XP_PER_ENTRY: float = _C["xp_per_entry"]
XP_LINE_COMPLETE: float = _C["xp_line_complete"]
DROP_P: dict[str, float] = _C["drop_p"]


@dataclass(frozen=True)
class Collectible:
    id: str
    name: str
    line: Line
    rarity: Rarity


CATALOG: dict[str, Collectible] = {
    e["id"]: Collectible(e["id"], e["name"], Line[e["line"]], Rarity[e["rarity"]]) for e in load("catalog")["entry"]
}
LINES = sorted({c.line for c in CATALOG.values()}, key=lambda line: line.name)


@dataclass(frozen=True)
class Drop:
    item: Collectible
    registered: bool
    sold_for: int


def roll(rng: random.Random, collect_level: int, rare_find: bool = False) -> Collectible:
    boost = (1 + LEVEL_BOOST_PER_LV * (collect_level - 1)) * (RARE_FIND_BOOST if rare_find else 1)
    items = list(CATALOG.values())
    count = {r: sum(1 for x in items if x.rarity is r) for r in Rarity}
    weights = [RARITY_WEIGHT[c.rarity] * (1 if c.rarity is Rarity.COMMON else boost) / count[c.rarity] for c in items]
    return rng.choices(items, weights)[0]


def obtain(player, item: Collectible) -> Drop:
    if item.id in player.collection:
        price = DUPLICATE_PRICE[item.rarity]
        player.money += price
        return Drop(item, False, price)
    player.collection.add(item.id)
    return Drop(item, True, 0)


def line_total(line: Line) -> int:
    return sum(1 for c in CATALOG.values() if c.line == line)


def xp_mult(collection: set[str], line: Line) -> float:
    total = line_total(line)
    if not total:
        return 1.0
    owned = sum(1 for c in CATALOG.values() if c.line == line and c.id in collection)
    return 1 + XP_PER_ENTRY * owned + (XP_LINE_COMPLETE if owned == total else 0)


def progress(collection: set[str]) -> list[tuple[Line, int, int, float]]:
    return [
        (
            line,
            sum(1 for c in CATALOG.values() if c.line == line and c.id in collection),
            line_total(line),
            xp_mult(collection, line),
        )
        for line in LINES
    ]
