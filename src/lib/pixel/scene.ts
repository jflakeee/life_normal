/** 마을 장면 계산 (순수 함수): 무엇을 어디에 그릴지만 정한다. 그리기는 TownScene.svelte가 한다.
 *  좌표는 논리 해상도(W×H) 기준이고, 화면에서는 정수배로 확대한다. */
import type { Line } from '$lib/core/enums';
import { BUILDINGS, TILE, type SpriteName } from './atlas';

export const W = 180;
export const H = 120;
export const FPS = 12;

export interface DrawOp {
	sprite: SpriteName;
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SceneState {
	/** 지금 진행 중인 작업의 계열 (없으면 null: 캐릭터가 길을 걷는다) */
	activeLine: Line | null;
	/** 진행 중인 연계 이벤트가 걸린 계열 */
	eventLines: Line[];
	/** 마을 틱 (8틱 = 1게임일, 낮밤에 쓴다) */
	townTick: number;
}

const ROAD_Y = 60;
const HOUSE_W = 2 * TILE;
const HOUSE_GAP = 4;
const BUILDING_LINES = Object.keys(BUILDINGS) as (keyof typeof BUILDINGS)[];

/** 계열별 건물(또는 수집 터) 위치. 탭 판정에도 쓴다 */
export const AREAS: Record<Line, Rect> = {
	...(Object.fromEntries(
		BUILDING_LINES.map((line, i) => [line, { x: 2 + i * (HOUSE_W + HOUSE_GAP), y: 8, w: HOUSE_W, h: 3 * TILE }])
	) as Record<keyof typeof BUILDINGS, Rect>),
	COLLECTING: { x: 112, y: 86, w: 48, h: 32 }
};

/** 움직이지 않는 바탕: 풀, 길, 나무, 집, 지붕 장식 */
export function staticLayer(): DrawOp[] {
	const ops: DrawOp[] = [];
	for (let r = 0; r * TILE < H; r++)
		for (let c = 0; c * TILE < W; c++) {
			const v = (c * 7 + r * 13) % 10; // 늘 같은 무늬 (난수 없이)
			ops.push({ sprite: v === 0 ? 'grass.flower' : v < 4 ? 'grass.1' : 'grass.0', x: c * TILE, y: r * TILE });
		}
	for (let c = 0; c * TILE < W; c++) ops.push({ sprite: `road.${c % 4}` as SpriteName, x: c * TILE, y: ROAD_Y });
	for (const [sprite, x, y] of [
		['tree.green', 4, 88],
		['tree.orange', 22, 98],
		['bush', 40, 90],
		['tree.green', 70, 100],
		['tree.orange', 164, 84],
		['mushroom', 116, 96],
		['mushroom', 136, 102]
	] as [SpriteName, number, number][])
		ops.push({ sprite, x, y });
	for (const line of BUILDING_LINES) {
		const { x, y } = AREAS[line];
		const b = BUILDINGS[line];
		ops.push(
			{ sprite: `roof.${b.roof}.l` as SpriteName, x, y },
			{ sprite: `roof.${b.roof}.r` as SpriteName, x: x + TILE, y },
			{ sprite: `roof.${b.roof}.bl` as SpriteName, x, y: y + TILE },
			{ sprite: `roof.${b.roof}.br` as SpriteName, x: x + TILE, y: y + TILE },
			{ sprite: `wall.${b.wall}.window` as SpriteName, x, y: y + 2 * TILE },
			{ sprite: `wall.${b.wall}.door` as SpriteName, x: x + TILE, y: y + 2 * TILE },
			{ sprite: b.icon, x: x + 8, y: y + 10 }
		);
	}
	return ops;
}

/** 왕복 이동: 0 → span → 0 */
const pingpong = (v: number, span: number) => {
	const m = v % (2 * span);
	return m < span ? m : 2 * span - m;
};

/** 움직이는 층: 내 캐릭터, 주민, 사건 표식. t = 초 */
export function dynamicLayer(s: SceneState, t: number): DrawOp[] {
	const ops: DrawOp[] = [];
	const blinkOn = Math.floor(t * 2) % 2 === 0;
	for (const line of new Set(s.eventLines)) {
		const a = AREAS[line];
		if (blinkOn) ops.push({ sprite: 'icon.event', x: a.x + a.w / 2 - 8, y: Math.max(0, a.y - 10) });
	}
	ops.push({ sprite: 'npc', x: Math.round(160 - pingpong(t * 9, 150)), y: ROAD_Y - 2 });
	const bob = Math.floor(t * 4) % 2; // 일하는 동안 1px 들썩임
	if (s.activeLine) {
		const a = AREAS[s.activeLine];
		const y = s.activeLine === 'COLLECTING' ? a.y : ROAD_Y - 4;
		ops.push({ sprite: 'player', x: a.x + a.w / 2 - 8, y: y - bob });
	} else {
		ops.push({ sprite: 'player', x: Math.round(8 + pingpong(t * 14, 150)), y: ROAD_Y - 4 });
	}
	return ops;
}

/** 낮밤: 게임일(8틱) 중 저녁·밤에 어둡게 */
export function nightAlpha(townTick: number): number {
	const phase = ((townTick % 8) + 8) % 8;
	return phase === 5 ? 0.15 : phase >= 6 ? 0.32 : 0;
}

/** 논리 좌표의 탭 → 계열 (건물·수집 터 밖이면 null) */
export function hitTest(x: number, y: number): Line | null {
	for (const [line, r] of Object.entries(AREAS) as [Line, Rect][])
		if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return line;
	return null;
}
