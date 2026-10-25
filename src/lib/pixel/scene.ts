/** 마을 장면 계산 (순수 함수): 무엇을 어디에 그릴지만 정한다. 그리기는 TownScene.svelte가 한다.
 *  마을은 세 구역(들판·산, 중심가, 항구)으로 나뉘고 한 번에 한 구역만 그린다.
 *  좌표는 논리 해상도(W×H) 기준이고, 화면에서는 정수배로 확대한다. */
import type { Line } from '$lib/core/enums';
import { BUILDINGS, TILE, type SpriteName } from './atlas';

export const W = 180;
export const H = 136;
export const FPS = 12;

export interface DrawOp {
	sprite: SpriteName | null; // null이면 색 사각형(rect)
	x: number;
	y: number;
	rect?: { w: number; h: number; color: string };
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
	/** 계열 건물 확장 단계 (0~2): 단계마다 지붕창이 하나씩 생긴다 */
	levels?: Partial<Record<Line, number>>;
	/** 계열 명성: 30점마다 지붕 아래에 금색 점 하나 */
	fame?: Partial<Record<Line, number>>;
}

export const DISTRICTS = ['field', 'center', 'harbor'] as const;
export type District = (typeof DISTRICTS)[number];
export const DISTRICT_NAME: Record<District, string> = { field: '들판·산', center: '중심가', harbor: '항구' };

const ROAD_Y = 60;
const HOUSE_W = 2 * TILE;
const HOUSE_GAP = 4;

/** 구역마다 위 줄에 서는 집 (최대 5채). 공공은 생기면 중심가 광장 자리에 선다 */
const TOP_ROW: Record<District, Line[]> = {
	field: ['AGRICULTURE', 'MINING', 'HUNTING', 'CONSTRUCTION', 'SPORT'],
	center: ['MEDICAL', 'SECURITY', 'ART', 'MUSIC', 'KNOWLEDGE'],
	harbor: ['TRANSPORT', 'SEA']
};

export const DISTRICT_OF = Object.fromEntries([
	...DISTRICTS.flatMap((d) => TOP_ROW[d].map((l) => [l, d])),
	['COLLECTING', 'field']
]) as Record<Line, District>;

/** 계열별 건물(또는 수집 숲) 위치. 탭 판정에도 쓴다 (좌표는 그 계열 구역 안 기준) */
export const AREAS: Record<Line, Rect> = {
	...(Object.fromEntries(
		DISTRICTS.flatMap((d) => TOP_ROW[d].map((line, i) => [line, { x: 2 + i * (HOUSE_W + HOUSE_GAP), y: 8, w: HOUSE_W, h: 3 * TILE }]))
	) as Record<Line, Rect>),
	COLLECTING: { x: 116, y: 92, w: 60, h: 40 }
};

const linesIn = (d: District) => (Object.keys(DISTRICT_OF) as Line[]).filter((l) => DISTRICT_OF[l] === d);

const WATER = '#4f8fcf';
const WAVE = '#8fc1ea';

/** 움직이지 않는 바탕: 풀, 길, 구역 꾸밈, 집(확장 단계별 지붕창), 지붕 장식, 명성 점 */
export function staticLayer(
	district: District = 'center',
	levels: Partial<Record<Line, number>> = {},
	fame: Partial<Record<Line, number>> = {}
): DrawOp[] {
	const ops: DrawOp[] = [];
	for (let r = 0; r * TILE < H; r++)
		for (let c = 0; c * TILE < W; c++) {
			const v = (c * 7 + r * 13) % 10; // 늘 같은 무늬 (난수 없이)
			ops.push({ sprite: v === 0 ? 'grass.flower' : v < 4 ? 'grass.1' : 'grass.0', x: c * TILE, y: r * TILE });
		}
	for (let c = 0; c * TILE < W; c++) ops.push({ sprite: `road.${c % 4}` as SpriteName, x: c * TILE, y: ROAD_Y });

	if (district === 'field') {
		// 밭 (흙 타일 3×2)과 수집 숲
		const farm: [SpriteName, number, number][] = [
			['farm.tl', 8, 88], ['farm.t', 24, 88], ['farm.tr', 40, 88],
			['farm.bl', 8, 104], ['farm.b', 24, 104], ['farm.br', 40, 104]
		];
		for (const [s, x, y] of farm) ops.push({ sprite: s, x, y });
		for (const [sprite, x, y] of [
			['bush', 70, 96], ['tree.green', 120, 92], ['tree.orange', 156, 94], ['mushroom', 128, 112], ['mushroom', 148, 116], ['tree.green', 162, 116]
		] as [SpriteName, number, number][])
			ops.push({ sprite, x, y });
	} else if (district === 'center') {
		// 광장 (지식·공공 건물이 들어설 자리)
		for (let c = 1; c < 10; c++) for (let r = 0; r < 3; r++) ops.push({ sprite: 'plaza', x: c * TILE, y: 84 + r * TILE });
		for (const [sprite, x, y] of [['tree.green', 2, 92], ['tree.orange', 164, 92]] as [SpriteName, number, number][])
			ops.push({ sprite, x, y });
	} else {
		// 부두와 바다 (Kenney 바다 타일을 붙이기 전까지 단색 물결)
		for (let c = 0; c * TILE < W; c++) ops.push({ sprite: 'fence', x: c * TILE, y: 78 });
		ops.push({ sprite: null, x: 0, y: 94, rect: { w: W, h: H - 94, color: WATER } });
		for (let i = 0; i < 9; i++) ops.push({ sprite: null, x: (i * 37) % W, y: 100 + (i * 11) % 30, rect: { w: 8, h: 1, color: WAVE } });
	}

	for (const line of linesIn(district)) {
		if (line === 'COLLECTING') continue;
		const { x, y } = AREAS[line];
		const b = BUILDINGS[line];
		const lv = levels[line] ?? 0;
		ops.push(
			{ sprite: `roof.${b.roof}.${lv >= 1 ? 'dormer' : 'l'}` as SpriteName, x, y },
			{ sprite: `roof.${b.roof}.${lv >= 2 ? 'dormer' : 'r'}` as SpriteName, x: x + TILE, y },
			{ sprite: `roof.${b.roof}.bl` as SpriteName, x, y: y + TILE },
			{ sprite: `roof.${b.roof}.br` as SpriteName, x: x + TILE, y: y + TILE },
			{ sprite: `wall.${b.wall}.window` as SpriteName, x, y: y + 2 * TILE },
			{ sprite: `wall.${b.wall}.door` as SpriteName, x: x + TILE, y: y + 2 * TILE },
			{ sprite: b.icon, x: x + 8, y: y + 10 }
		);
		for (let i = 0; i < fameDots(fame[line] ?? 0); i++)
			ops.push({ sprite: null, x: x + 3 + i * 5, y: y + 2 * TILE - 4, rect: { w: 3, h: 3, color: '#f2c335' } });
	}
	return ops;
}

/** 명성 점 개수: 30·60·90점에 하나씩 */
export const fameDots = (fame: number) => Math.min(3, Math.floor(fame / 30));

/** 왕복 이동: 0 → span → 0 */
const pingpong = (v: number, span: number) => {
	const m = v % (2 * span);
	return m < span ? m : 2 * span - m;
};

/** 움직이는 층: 내 캐릭터, 주민, 사건 표식 (보이는 구역의 것만). t = 초 */
export function dynamicLayer(s: SceneState, t: number, district: District = 'center'): DrawOp[] {
	const ops: DrawOp[] = [];
	const blinkOn = Math.floor(t * 2) % 2 === 0;
	for (const line of new Set(s.eventLines)) {
		if (DISTRICT_OF[line] !== district) continue;
		const a = AREAS[line];
		if (blinkOn) ops.push({ sprite: 'icon.event', x: a.x + a.w / 2 - 8, y: Math.max(0, a.y - 10) });
	}
	ops.push({ sprite: 'npc', x: Math.round(160 - pingpong(t * 9, 150)), y: ROAD_Y - 2 });
	const bob = Math.floor(t * 4) % 2; // 일하는 동안 1px 들썩임
	if (s.activeLine && DISTRICT_OF[s.activeLine] === district) {
		const a = AREAS[s.activeLine];
		const y = s.activeLine === 'COLLECTING' ? a.y : ROAD_Y - 4;
		ops.push({ sprite: 'player', x: a.x + a.w / 2 - 8, y: y - bob });
	} else {
		ops.push({ sprite: 'player', x: Math.round(8 + pingpong(t * 14, 150)), y: ROAD_Y - 4 });
	}
	return ops;
}

/** 사건이 걸린 구역 (구역 점에 표시) */
export const districtsWithEvents = (lines: Line[]) => new Set(lines.map((l) => DISTRICT_OF[l]));

/** 낮밤: 게임일(8틱) 중 저녁·밤에 어둡게 */
export function nightAlpha(townTick: number): number {
	const phase = ((townTick % 8) + 8) % 8;
	return phase === 5 ? 0.15 : phase >= 6 ? 0.32 : 0;
}

/** 논리 좌표의 탭 → 계열 (보이는 구역의 건물·수집 숲 밖이면 null) */
export function hitTest(x: number, y: number, district: District = 'center'): Line | null {
	for (const line of linesIn(district)) {
		const r = AREAS[line];
		if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return line;
	}
	return null;
}
