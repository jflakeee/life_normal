# 일상 임무 게임 (daily-missions)

설계안 v3의 코어 로직, 경제 시뮬레이터, CLI 프로토타입.

```
core/            순수 게임 로직 (모델, 임무·연계 이벤트, 수집 도감)
  data/          balance.toml · missions.toml · catalog.toml  ← 수치와 콘텐츠는 여기서 수정
sim/             경제 시뮬레이터 (회수율·계층 수입 검증)
server/          FastAPI + SQLite 서버 (지연 평가 타이머, 멱등 명령, ledger)
tools/           오프라인 CLI(play.py), 저장(save.py), 서버 접속 CLI(client.py)
client/          모바일 웹 PWA (SvelteKit, 하단 탭 5개, 도장판, WebSocket 알림)
tests/           단위·속성·저장 호환·밸런스 회귀 테스트
```

## 시작

```bash
uv sync --group dev
uv run python -m tools.play          # 오프라인 CLI 플레이 (help로 명령어)
uv run uvicorn server.app:create_app --factory --reload   # 서버 (DB: DAILY_MISSIONS_DB, 기본 daily_missions.db)
uv run python -m tools.client        # 서버 접속 CLI (API 문서: http://127.0.0.1:8000/docs)
uv run python -m sim.economy_sim     # 경제 시뮬레이션 리포트
uv run pytest                        # 빠른 테스트
uv run pytest -m slow                # 전체 규모 밸런스 회귀 (약 30초)
uv run pre-commit install            # 커밋 전 ruff·pyright
```

## 모바일 웹 클라이언트

```bash
cd client && npm ci
npm run dev        # 개발 서버 (API는 127.0.0.1:8000의 FastAPI로 프록시)
npm run build      # build/ 생성 → FastAPI가 같은 주소에서 서빙
npm test           # vitest
npm run e2e        # Playwright, 360×640 세로 화면 (빌드 후)
npm run size       # JS 150 KB(gzip) 예산 검사
```

빌드 후 `uv run uvicorn server.app:create_app --factory`만 띄우면 http://127.0.0.1:8000 에서 게임이 열린다.

## 수치를 바꿀 때

`core/data/balance.toml`을 고치고 `uv run pytest -m slow`로 목표를 확인한다.
목표: 회수율 0.8 이상, 전원 사업 도달, 사업 도달 중앙값 100~160 활동시간, 취미 < 직업 < 사업 수입.
다른 데이터 폴더로 실험하려면 `DAILY_MISSIONS_DATA=경로`를 지정한다.
