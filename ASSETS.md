# 그래픽 에셋 출처

지금 쓰는 픽셀 그래픽은 모두 CC0(퍼블릭 도메인) 무료 에셋이다. 추후 직접 그린 아트로 바꾼다.
교체할 때는 `src/lib/pixel/assets/`의 PNG와 `src/lib/pixel/atlas.ts`의 좌표만 바꾸면 된다 (장면 코드는 스프라이트 이름만 쓴다).

| 파일 | 원본 | 라이선스 | 받은 곳 |
| --- | --- | --- | --- |
| tiny_town.png | Kenney "Tiny Town" (16×16 타일) https://kenney.nl/assets/tiny-town | CC0 | github.com/dimforge/kiss3d `examples/media/tiny_town.png` (credits.txt에 출처·라이선스 표기) |
| townie_blue.png, townie_purple.png | Kenney "Tiny Dungeon" 캐릭터 https://kenney.nl/assets/tiny-dungeon | CC0 | github.com/JimWhiteheadUCSC/Pathfinder `assets/` (README에 출처 표기) |

## 글꼴

| 파일 | 원본 | 라이선스 |
| --- | --- | --- |
| src/lib/fonts/galmuri11-bold.woff2, galmuri14.woff2 | 갈무리 (Lee Minseo, https://github.com/quiple/galmuri), npm `galmuri` 2.40.3 | SIL OFL 1.1 (전문: src/lib/fonts/OFL.md) |

게임에 쓰인 글자만 남긴 부분 집합이다. 새 글자를 쓰면 `npm run fonts`로 다시 만든다 (빠뜨리면 font.test.ts가 실패).

CC0 그래픽은 표기 의무가 없지만, 고마움의 뜻으로 남긴다. Thanks, Kenney.
