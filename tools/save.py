"""play.Game 저장/불러오기 (JSON).

플레이어, 세계(시장·효과·보너스), 게시판(연계 이벤트 진행 포함), 난수 상태까지 저장해
불러온 뒤에도 저장 시점과 똑같이 이어진다.
"""

from __future__ import annotations

import json
from pathlib import Path

from core.serialize import player_from_dict, player_to_dict, town_from_dict, town_to_dict

SAVE_VERSION = 2  # v2: 근무일(work_days) → 직업 임무 수(job_missions)


def to_dict(g) -> dict:
    return {
        "version": SAVE_VERSION,
        "player": player_to_dict(g.p),
        **town_to_dict(g.world, g.board, g.rng),
        "game": {"worked_today": g.worked_today, "tax_carry": g.tax_carry, "log_seen": g.log_seen},
    }


def migrate(d: dict) -> dict:
    """이전 버전 세이브를 현재 버전으로 변환"""
    v = d.get("version")
    if v == 1:  # 근무 게임일 → 직업 임무 수 (1게임일 = 임무 8건)
        for job in d["player"]["jobs"].values():
            job[1] = job[1] * 8
        d["version"] = v = 2
    if v != SAVE_VERSION:
        raise ValueError(f"지원하지 않는 저장 버전: {v}")
    return d


def from_dict(d: dict, out=print):
    from tools.play import Game  # 순환 import 방지

    d = migrate(d)
    g = Game(out=out)
    g.p = player_from_dict(d["player"])
    g.world, g.board, g.rng = town_from_dict(d)
    gd = d["game"]
    g.worked_today, g.tax_carry, g.log_seen = gd["worked_today"], gd["tax_carry"], gd["log_seen"]
    g.menu, g.menu_tick = [], -1
    return g


def save_game(g, path: str | Path) -> None:
    Path(path).write_text(json.dumps(to_dict(g), ensure_ascii=False), encoding="utf-8")


def load_game(path: str | Path, out=print):
    return from_dict(json.loads(Path(path).read_text(encoding="utf-8")), out=out)
