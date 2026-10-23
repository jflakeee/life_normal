/** 스프라이트 이름 → 그림 좌표. 직접 그린 아트로 바꿀 때는 이 파일과 PNG만 바꾼다. */
import type { Line } from '$lib/core/enums';
import npcUrl from './assets/townie_purple.png';
import playerUrl from './assets/townie_blue.png';
import townUrl from './assets/tiny_town.png';

export const TILE = 16;
export const SHEETS = { town: townUrl, player: playerUrl, npc: npcUrl } as const;
export type SheetName = keyof typeof SHEETS;

export interface Sprite {
	sheet: SheetName;
	x: number;
	y: number;
	w: number;
	h: number;
}

const COLS = 12; // tiny_town.png: 12×11 타일
const tile = (i: number): Sprite => ({ sheet: 'town', x: (i % COLS) * TILE, y: Math.floor(i / COLS) * TILE, w: TILE, h: TILE });

export const SPRITES = {
	'grass.0': tile(0),
	'grass.1': tile(1),
	'grass.flower': tile(2),
	'road.0': tile(39),
	'road.1': tile(40),
	'road.2': tile(41),
	'road.3': tile(42),
	'tree.green': tile(28), // 한 칸짜리 나무 (4·3번은 두 칸짜리 나무의 윗부분)
	'tree.orange': tile(27),
	'bush': tile(5),
	'mushroom': tile(29),
	'roof.blue.l': tile(48),
	'roof.blue.dormer': tile(51), // 지붕창: 건물 확장 단계마다 하나씩
	'roof.blue.r': tile(50),
	'roof.blue.bl': tile(60),
	'roof.blue.br': tile(62),
	'roof.red.l': tile(52),
	'roof.red.dormer': tile(55),
	'roof.red.r': tile(54),
	'roof.red.bl': tile(64),
	'roof.red.br': tile(66),
	'wall.wood.window': tile(84),
	'wall.wood.door': tile(85),
	'wall.stone.window': tile(88),
	'wall.stone.door': tile(89),
	'icon.barrel': tile(130),
	'icon.bow': tile(118),
	'icon.hammer': tile(128),
	'icon.potion': tile(104),
	'icon.key': tile(117),
	'icon.event': tile(95),
	'icon.sign': tile(83), // 간판 → 예술
	'icon.drum': tile(107), // 북 모양 항아리 → 음악
	'icon.medal': tile(93), // 금화 → 메달, 운동
	'player': { sheet: 'player', x: 0, y: 0, w: 16, h: 16 },
	'npc': { sheet: 'npc', x: 0, y: 0, w: 16, h: 16 }
} satisfies Record<string, Sprite>;

export type SpriteName = keyof typeof SPRITES;

/** 계열별 집 모양: 지붕 색, 벽 재질, 지붕 장식 */
export const BUILDINGS: Record<Exclude<Line, 'COLLECTING'>, { roof: 'blue' | 'red'; wall: 'wood' | 'stone'; icon: SpriteName }> = {
	TRANSPORT: { roof: 'red', wall: 'wood', icon: 'icon.barrel' },
	HUNTING: { roof: 'blue', wall: 'wood', icon: 'icon.bow' },
	CONSTRUCTION: { roof: 'red', wall: 'stone', icon: 'icon.hammer' },
	MEDICAL: { roof: 'blue', wall: 'stone', icon: 'icon.potion' },
	SECURITY: { roof: 'red', wall: 'stone', icon: 'icon.key' },
	ART: { roof: 'blue', wall: 'wood', icon: 'icon.sign' },
	MUSIC: { roof: 'red', wall: 'wood', icon: 'icon.drum' },
	SPORT: { roof: 'blue', wall: 'stone', icon: 'icon.medal' }
};
