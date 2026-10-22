"""HTTP API (설계안 '서버 API와 데이터 모델' 섹션).

실행: uv run uvicorn server.app:create_app --factory --reload
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .db import Clock, Database
from .service import Conflict, GameError, GameService, Session, audit, economy_report

Json = dict[str, Any]


class QueueBody(BaseModel):
    template_id: str
    count: int = Field(1, ge=1, le=20)


class BuyBody(BaseModel):
    item: str


class LineBody(BaseModel):
    line: str


def _service(request: Request) -> GameService:
    return request.app.state.service


def _player(request: Request, authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authorization: Bearer <token> 필요")
    pid = _service(request).player_for_token(authorization.removeprefix("Bearer "))
    if pid is None:
        raise HTTPException(401, "알 수 없는 토큰")
    return pid


# 의존성 별칭은 모듈 수준에 둔다 (from __future__ annotations에서 FastAPI가 이름을 찾을 수 있게)
PlayerId = Annotated[str, Depends(_player)]
IdemKey = Annotated[str | None, Header(alias="Idempotency-Key")]


CLIENT_BUILD = Path(os.environ.get("DAILY_MISSIONS_CLIENT", Path(__file__).parents[1] / "client" / "build"))


def create_app(db_path: str | None = None, clock: Clock | None = None, ws_poll: float = 5.0) -> FastAPI:
    app = FastAPI(title="일상 임무 게임 API", version="0.3.0")
    app.state.service = GameService(
        Database(db_path or os.environ.get("DAILY_MISSIONS_DB", "daily_missions.db")), clock
    )

    @app.exception_handler(GameError)
    async def _game_error(_: Request, e: GameError) -> JSONResponse:
        return JSONResponse({"error": str(e)}, status_code=409)

    @app.exception_handler(Conflict)
    async def _conflict(_: Request, e: Conflict) -> JSONResponse:
        return JSONResponse({"error": "동시 수정 충돌, 다시 시도하세요"}, status_code=409)

    def service() -> GameService:
        return app.state.service

    def command(pid: str, key: str | None, fn: Callable[[Session], Json]) -> JSONResponse:
        if not key:
            raise HTTPException(400, "Idempotency-Key 헤더 필요")
        result, replayed = service().command(pid, key, fn)
        return JSONResponse(result, headers={"Idempotent-Replayed": "true"} if replayed else {})

    # ── 계정 · 조회 ───────────────────────────────────
    @app.post("/auth/guest")
    def guest() -> Json:
        return service().create_guest()

    @app.get("/state")
    def state(pid: PlayerId) -> Json:
        svc = service()
        return svc.query(pid, svc.state)

    @app.get("/board")
    def board(pid: PlayerId) -> Json:
        svc = service()
        return svc.query(pid, svc.board)

    @app.get("/catalog")
    def catalog() -> Json:
        return service().catalog()

    @app.get("/market")
    def market(pid: PlayerId) -> Json:
        svc = service()
        return svc.query(pid, svc.market)

    @app.get("/collection")
    def collection(pid: PlayerId) -> Json:
        svc = service()
        return svc.query(pid, svc.collection)

    # ── 명령 (모두 Idempotency-Key 필요) ──────────────
    @app.post("/queue")
    def enqueue(body: QueueBody, pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, lambda s: service().enqueue(s, body.template_id, body.count))

    @app.delete("/queue/{run_id}")
    def cancel(run_id: int, pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, lambda s: service().cancel(s, run_id))

    @app.post("/board/{posting_id}/accept")
    def accept(posting_id: str, pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, lambda s: service().accept(s, posting_id))

    @app.post("/claims")
    def claims(pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, service().claim)

    @app.post("/jobs/{line}")
    def take_job(line: str, pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, lambda s: service().take_job(s, line))

    @app.post("/jobs/{line}/promote")
    def promote(line: str, pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, lambda s: service().promote(s, line))

    @app.post("/businesses")
    def open_business(body: LineBody, pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, lambda s: service().open_business(s, body.line))

    @app.post("/businesses/collect")
    def collect(pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, service().collect)

    @app.post("/shop/buy")
    def buy(body: BuyBody, pid: PlayerId, key: IdemKey = None) -> JSONResponse:
        return command(pid, key, lambda s: service().buy(s, body.item))

    # ── 알림 ─────────────────────────────────────────
    @app.websocket("/ws")
    async def ws(websocket: WebSocket, token: str = "") -> None:
        """알림 전용. 놓친 알림은 GET /state 스냅숏으로 복구하므로 재전송을 보장하지 않는다."""
        svc = service()
        pid = svc.player_for_token(token)
        if pid is None:
            await websocket.close(code=4401)
            return
        cursor: Json = {}
        # 연결 시점을 기준으로 삼는다 (그 전 상태는 클라이언트가 GET /state로 이미 받았다)
        await run_in_threadpool(svc.query, pid, lambda s: {"events": svc.notifications(s, cursor)})
        await websocket.accept()
        try:
            while True:
                events = await run_in_threadpool(svc.query, pid, lambda s: {"events": svc.notifications(s, cursor)})
                for e in events["events"]:
                    await websocket.send_json(e)
                with contextlib.suppress(TimeoutError):  # 클라이언트 ping을 기다리며 다음 확인까지 쉰다
                    await asyncio.wait_for(websocket.receive_text(), timeout=ws_poll)
        except WebSocketDisconnect:
            return

    # ── 운영 (개발용, 4단계에서 관리자 인증 추가) ──────
    @app.get("/admin/audit")
    def admin_audit() -> Json:
        return {"mismatches": audit(service().db)}

    @app.get("/admin/economy")
    def admin_economy() -> Json:
        return economy_report(service().db)

    # 빌드된 PWA를 같은 주소에서 서빙 (API 경로가 먼저 매칭된다)
    if (CLIENT_BUILD / "index.html").exists():
        app.mount("/", StaticFiles(directory=CLIENT_BUILD, html=True), name="client")

    return app
