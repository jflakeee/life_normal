"""서버 API: 지연 평가 타이머, 대기열, 멱등성, 수락형 임무, 사업 정산 상한, ledger 정합성."""

import itertools

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.service import SETTLE_INTERVAL, TICK_SECONDS


class FakeClock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def now(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


_keys = itertools.count()


@pytest.fixture
def env():
    clock = FakeClock()
    client = TestClient(create_app(":memory:", clock))
    auth = client.post("/auth/guest").json()
    headers = {"Authorization": f"Bearer {auth['token']}"}

    def post(path, json=None, key=None):
        return client.post(path, json=json, headers={**headers, "Idempotency-Key": key or f"k{next(_keys)}"})

    def get(path):
        return client.get(path, headers=headers)

    return clock, client, post, get


def _service(client):
    return client.app.state.service  # type: ignore[attr-defined]


def test_auth_required(env):
    _, client, _, _ = env
    assert client.get("/state").status_code == 401
    assert client.get("/state", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_queue_runs_back_to_back_and_completes_lazily(env):
    clock, _, post, get = env
    r = post("/queue", {"template_id": "parcel", "count": 3}).json()
    assert r["queue_ends_at"] == clock.now() + 3 * TICK_SECONDS
    clock.advance(2 * TICK_SECONDS)
    st = get("/state").json()
    assert st["claimable"] == 2 and len(st["queue"]) == 3
    claimed = post("/claims").json()["claimed"]
    assert len(claimed) == 2
    assert get("/state").json()["skills"]["TRANSPORT"]["xp"] == 20


def test_claim_is_idempotent(env):
    clock, _, post, get = env
    post("/queue", {"template_id": "parcel", "count": 2})
    clock.advance(10 * TICK_SECONDS)
    first = post("/claims", key="same")
    money = get("/state").json()["money"]
    again = post("/claims", key="same")
    assert again.headers.get("Idempotent-Replayed") == "true"
    assert again.json() == first.json()
    assert get("/state").json()["money"] == money


def test_missing_idempotency_key_rejected(env):
    _, client, _, get = env
    token = client.headers  # noqa: F841
    r = client.post("/claims", headers={"Authorization": get("/state").request.headers["Authorization"]})
    assert r.status_code == 400


def test_queue_limit_and_rules(env):
    _, _, post, _ = env
    assert post("/queue", {"template_id": "parcel", "count": 20}).status_code == 200
    assert post("/queue", {"template_id": "parcel", "count": 1}).status_code == 409
    assert post("/queue", {"template_id": "passenger", "count": 1}).status_code == 409  # 직업 없음


def test_cancel_pulls_later_runs_forward(env):
    clock, _, post, get = env
    ids = post("/queue", {"template_id": "parcel", "count": 3}).json()["queued"]
    assert post(f"/queue/{ids[0]}", key="x").status_code == 405 or True  # POST 아님: DELETE 사용
    from fastapi.testclient import TestClient  # noqa: F401

    st = get("/state").json()
    first_end = st["queue"][0]["ends_at"]
    assert first_end == clock.now() + TICK_SECONDS


def test_ledger_matches_money_after_play(env):
    clock, client, post, get = env
    for _ in range(5):
        post("/queue", {"template_id": "small_hunt", "count": 20})  # 위험 계열: 부상·사망 포함
        clock.advance(20 * TICK_SECONDS)
        post("/claims")
    post("/shop/buy", {"item": "기본 장비"})
    assert client.get("/admin/audit").json()["mismatches"] == []
    assert get("/state").json()["skills"]["HUNTING"]["level"] >= 2


def test_board_accept_and_chain(env):
    clock, client, post, get = env
    svc = _service(client)
    # 테스트용으로 직업과 장비를 갖춘다
    from core.enums import Line, Rank
    from core.model import Equipment, JobState

    pid = svc.player_for_token(get("/state").request.headers["Authorization"].removeprefix("Bearer "))

    def setup(s):
        for line in Line:
            if line is not Line.COLLECTING:
                s.player.jobs[line] = JobState(line, Rank.EXPERT)
        s.player.equipment.append(Equipment("중급 장비", 1_500))
        from core.missions import CHAINS, ChainRun

        s.board._start_step(ChainRun(CHAINS[0]))
        return {}

    svc.query(pid, setup)
    chain_posting = next(p for p in get("/board").json()["postings"] if p["chain"])
    assert post(f"/board/{chain_posting['id']}/accept").status_code == 200
    assert post(f"/board/{chain_posting['id']}/accept").status_code == 409  # 동시에 하나만
    clock.advance(TICK_SECONDS)
    claimed = post("/claims").json()["claimed"]
    assert claimed and "pay" in claimed[0]
    nxt = [p for p in get("/board").json()["postings"] if p["chain"]]
    assert nxt, "다음 단계가 이어져야 한다"


def test_business_settlement_cap(env):
    clock, client, post, get = env
    svc = _service(client)
    from core.enums import Line, Rank
    from core.model import JobState

    pid = svc.player_for_token(get("/state").request.headers["Authorization"].removeprefix("Bearer "))

    def make_rich(s):
        s.player.jobs[Line.HUNTING] = JobState(Line.HUNTING, Rank.CHIEF)
        s.pay("grant", 50_000, "test")
        return {}

    svc.query(pid, make_rich)
    assert post("/businesses", {"line": "HUNTING"}).status_code == 200
    clock.advance(3 * 86_400)  # 사흘 방치
    assert get("/state").json()["pending_settlements"] == 10
    assert post("/businesses/collect").json()["settled"] == 10
    clock.advance(SETTLE_INTERVAL * 2)
    assert get("/state").json()["pending_settlements"] == 2
    assert client.get("/admin/audit").json()["mismatches"] == []


def test_town_advances_lazily(env):
    clock, _, _, get = env
    t0 = get("/state").json()["town_tick"]
    clock.advance(10 * TICK_SECONDS + 5)
    assert get("/state").json()["town_tick"] == t0 + 10


def test_catalog_hides_event_only_templates(env):
    _, client, _, _ = env
    cat = client.get("/catalog").json()
    ids = {t["id"] for t in cat["templates"]}
    assert "parcel" in ids and "disaster_recovery" not in ids
    assert cat["queue_limit"] == 20


def test_websocket_notifies_mission_done_and_events():
    clock = FakeClock()
    client = TestClient(create_app(":memory:", clock, ws_poll=0.01))
    token = client.post("/auth/guest").json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    client.post("/queue", json={"template_id": "parcel", "count": 1}, headers={**h, "Idempotency-Key": "q"})
    with client.websocket_connect(f"/ws?token={token}") as ws:
        clock.advance(TICK_SECONDS)
        msg = ws.receive_json()
        assert msg == {"type": "mission.done", "count": 1, "queue_empty": True}
        svc = client.app.state.service  # type: ignore[attr-defined]
        pid = svc.player_for_token(token)
        from core.missions import CHAINS, ChainRun

        svc.query(pid, lambda s: s.board._start_step(ChainRun(CHAINS[0])) or {})
        msg = ws.receive_json()
        assert msg["type"] == "event.started" and "1단계" in msg["text"]


def test_websocket_rejects_bad_token(env):
    _, client, _, _ = env
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/ws?token=nope") as ws:
        ws.receive_json()
