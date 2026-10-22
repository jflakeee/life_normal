import json
import random

from core.enums import Line
from tools.play import Game
from tools.save import from_dict, load_game, migrate, save_game, to_dict


def _script(g, n, seed):
    r = random.Random(seed)
    for _ in range(n):
        g.handle("m")
        opts = [k for k, x in enumerate(g.menu, 1) if x.mission.id in g.board.postings and x.mission.available_to(g.p)]
        g.handle(str(r.choice(opts)) if opts else "wait")
        if g.p.can_take_job(Line.HUNTING) and Line.HUNTING not in g.p.jobs:
            g.handle("job 사냥")
            g.handle("buy 1")


def test_roundtrip_continues_identically(tmp_path):
    g = Game(seed=5, out=lambda *_: None)
    _script(g, 300, 1)
    path = tmp_path / "s.json"
    save_game(g, path)
    h = load_game(path, out=lambda *_: None)
    assert to_dict(g) == to_dict(h)
    a, b = [], []
    g.out, h.out = a.append, b.append
    _script(g, 200, 2)
    _script(h, 200, 2)
    assert a == b and to_dict(g) == to_dict(h)


def test_v1_save_migrates_work_days():
    g = Game(seed=1, out=lambda *_: None)
    g.p.skills[Line.HUNTING].add_xp(10_000)
    g.handle("job 사냥")
    d = json.loads(json.dumps(to_dict(g)))
    d["version"] = 1
    d["player"]["jobs"]["HUNTING"][1] = 5  # v1: 근무 5게임일
    assert migrate(d)["player"]["jobs"]["HUNTING"][1] == 40
    assert from_dict(d, out=lambda *_: None).p.jobs[Line.HUNTING].job_missions == 40


def test_save_and_load_commands(tmp_path):
    # 회귀: 리팩터링 중 Game.save/load 메서드가 사라졌던 문제 (명령어 경로로 검사)
    out: list[str] = []
    g = Game(seed=2, out=out.append)
    path = str(tmp_path / "c.json")
    g.handle(f"save {path}")
    g.handle("wait")
    g.handle(f"load {path}")
    g.handle(f"load {tmp_path / 'none.json'}")
    assert any("저장 완료" in x for x in out)
    assert any("불러오기 완료" in x for x in out)
    assert any("불러오기 실패" in x for x in out)
    assert g.world.tick == 0
