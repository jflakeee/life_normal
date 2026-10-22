# 동네 임무 (life_normal)

배달·수렵·채집 같은 일상 임무로 돈을 벌고, 취미 → 직업 → 사업으로 성장하는 모바일 웹 게임.
게임 전체가 브라우저 안에서 돌아서 GitHub Pages에 그대로 올라간다. 진행은 브라우저(localStorage)에 저장된다.

**플레이:** https://jflakeee.github.io/life_normal/

```
src/lib/core/      게임 규칙 (모델, 임무·연계 이벤트, 수집 도감, 시드 난수)
  data/            balance.json · missions.json · catalog.json  ← 수치와 콘텐츠는 여기서 수정
src/lib/local/     브라우저 안 백엔드 (지연 평가 타이머, 멱등 명령, ledger, 알림)
src/lib/sim/       경제 시뮬레이터 + 밸런스 회귀 테스트
src/lib/tabs/      화면 (홈, 임무, 마을, 상점, 나)
e2e/               360×640 Playwright 테스트
```

## 시작

```bash
npm ci
npm run dev        # 개발 서버
npm test           # 단위 + 백엔드 + 전체 규모 밸런스 회귀 (약 5초)
npm run sim        # 밸런스 테스트를 자세히
BASE_PATH=/life_normal npm run build && npm run size   # Pages용 빌드, JS 150 KB 예산
npx playwright install chromium && npm run e2e         # 하위 경로 빌드로 E2E
```

## 배포

한 파일 빌드: `npm run build:single` → `dist-artifact/index.html` 하나로 게임 전체가 열린다 (외부 파일 없음, claude.ai 아티팩트 등).


`main`에 푸시하면 `pages` 워크플로가 테스트 → 빌드 → GitHub Pages 배포를 한다.
처음 한 번은 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 바꿔야 한다.

## 수치를 바꿀 때

`src/lib/core/data/balance.json`을 고치고 `npm test`로 목표를 확인한다.
목표: 회수율 0.8 이상, 99% 이상 사업 도달, 사업 도달 중앙값 100~160 활동시간, 취미 < 직업 < 사업 수입.
