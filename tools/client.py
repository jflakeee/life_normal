"""서버 접속형 CLI (표준 라이브러리만 사용).

실행: python -m tools.client [--url http://127.0.0.1:8000]
첫 실행 때 게스트 계정을 만들고 토큰을 .client_token에 저장한다.
명령마다 새 Idempotency-Key를 붙이고, 네트워크 오류로 재시도할 때는 같은 키를 다시 쓴다.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

TOKEN_FILE = Path(".client_token")
RETRIES = 3

HELP = """명령어
  s                   상태 (대기열, 받을 보상, 사업 정산)
  b                   게시판 (연계 이벤트가 맨 위)
  q <템플릿> [건수]    상시 임무 예약 (예: q parcel 5)
  cancel <run id>     시작 전 예약 취소
  a <게시물 id>        의뢰·돌발 수락
  c                   완료 보상 받기
  job <계열> / up <계열>   직업 취득 / 승급 (예: job HUNTING)
  buy <상품>          장비 구매 (예: buy 기본 장비)
  biz <계열> / collect     사업 개설 / 정산 받기
  market / dex        시세 / 도감
  quit"""


class Api:
    def __init__(self, url: str):
        self.url = url.rstrip("/")
        self.token = TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else None

    def _send(self, method: str, path: str, body: Any = None, key: str | None = None) -> Any:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if key:
            headers["Idempotency-Key"] = key
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        for attempt in range(RETRIES):
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                return {"error": json.loads(e.read() or b"{}").get("error") or e.reason, "status": e.code}
            except urllib.error.URLError:
                if attempt == RETRIES - 1:
                    raise
                time.sleep(0.5 * 2**attempt)  # 같은 Idempotency-Key로 재시도 → 서버는 한 번만 처리

    def get(self, path: str) -> Any:
        return self._send("GET", path)

    def cmd(self, method: str, path: str, body: Any = None) -> Any:
        return self._send(method, path, body, key=uuid.uuid4().hex)

    def login(self) -> None:
        if not self.token:
            acc = self._send("POST", "/auth/guest")
            self.token = acc["token"]
            TOKEN_FILE.write_text(self.token)
            print(f"게스트 계정 생성 (마을 {acc['town_id']})")


def show_state(st: dict[str, Any]) -> None:
    if "error" in st:
        print("!", st["error"])
        return
    now = st["now"]
    print(f"돈 {st['money']:,} G · 평판 {st['reputation']} · 받을 보상 {st['claimable']}건")
    for line, sk in st["skills"].items():
        job = st["jobs"].get(line)
        if sk["level"] > 1 or sk["xp"] or job:
            tag = f" · {job['rank']} (부족: {', '.join(job['missing']) or '없음'})" if job else ""
            print(f"  {line} Lv {sk['level']} ({sk['xp']} XP){tag}")
    if st["queue"]:
        print("  대기열:")
        for r in st["queue"]:
            left = max(0, r["ends_at"] - now)
            status = "완료" if r["done"] else f"{left / 60:.1f}분 남음"
            print(f"    #{r['id']} {r['name']} {r['reward']} G · {status}")
    if st["businesses"]:
        print(f"  사업 {len(st['businesses'])}개 · 받을 정산 {st['pending_settlements']}회")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    api = Api(ap.parse_args().url)
    api.login()
    print("help로 명령어 확인")
    while True:
        try:
            parts = input("> ").strip().split()
        except EOFError:
            break
        if not parts:
            continue
        c, args = parts[0], parts[1:]
        if c == "quit":
            break
        elif c == "s":
            show_state(api.get("/state"))
        elif c == "b":
            for p in api.get("/board").get("postings", []):
                star = f"★{p['chain']} " if p["chain"] else ""
                lock = "" if p["available"] else " (잠김)"
                print(f"  {p['id']}  {star}[{p['line']}/{p['type']}] {p['name']} {p['reward']} G{lock}")
        elif c == "q" and args:
            print(api.cmd("POST", "/queue", {"template_id": args[0], "count": int(args[1]) if len(args) > 1 else 1}))
        elif c == "cancel" and args:
            print(api.cmd("DELETE", f"/queue/{args[0]}"))
        elif c == "a" and args:
            print(api.cmd("POST", f"/board/{args[0]}/accept"))
        elif c == "c":
            res = api.cmd("POST", "/claims")
            for item in res.get("claimed", []):
                print(f"  {item['name']} +{item.get('reward', 0):g} G", item.get("drop", ""), item.get("incident", ""))
            print(f"  돈 {res.get('money')}")
        elif c in ("job", "up") and args:
            print(api.cmd("POST", f"/jobs/{args[0]}" + ("/promote" if c == "up" else "")))
        elif c == "buy" and args:
            print(api.cmd("POST", "/shop/buy", {"item": " ".join(args)}))
        elif c == "biz" and args:
            print(api.cmd("POST", "/businesses", {"line": args[0]}))
        elif c == "collect":
            print(api.cmd("POST", "/businesses/collect"))
        elif c == "market":
            for k, v in api.get("/market").items():
                print(f"  {v['name']}({k}) {v['price']} G (기준 {v['base']})")
        elif c == "dex":
            for k, v in api.get("/collection").items():
                print(f"  {k}: {v['owned']}/{v['total']} · 경험치 ×{v['xp_mult']}")
        else:
            print(HELP)


if __name__ == "__main__":
    main()
