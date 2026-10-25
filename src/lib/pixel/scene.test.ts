import { describe, expect, it } from 'vitest';
import { LINES } from '$lib/core/enums';
import { BUILDINGS, SPRITES } from './atlas';
import { AREAS, dynamicLayer, H, hitTest, nightAlpha, staticLayer, W } from './scene';

const SHEET_SIZE = { town: [192, 176], player: [16, 16], npc: [16, 16] } as const;

describe('pixel atlas', () => {
	it('every sprite lies inside its sheet', () => {
		for (const [name, s] of Object.entries(SPRITES)) {
			const [w, h] = SHEET_SIZE[s.sheet];
			expect(s.x + s.w <= w && s.y + s.h <= h, name).toBe(true);
		}
	});

	it('every line has a place in town', () => {
		for (const line of LINES) expect(AREAS[line], line).toBeDefined();
		expect(Object.keys(BUILDINGS)).toHaveLength(8);
	});
});

describe('pixel scene', () => {
	it('areas fit the scene and do not overlap', () => {
		const rs = Object.values(AREAS);
		for (const r of rs) expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H).toBe(true);
		for (let i = 0; i < rs.length; i++)
			for (let j = i + 1; j < rs.length; j++) {
				const [a, b] = [rs[i], rs[j]];
				const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
				expect(overlap).toBe(false);
			}
	});

	it('the static layer only uses known sprites', () => {
		for (const op of staticLayer()) if (op.sprite) expect(SPRITES[op.sprite], op.sprite).toBeDefined();
	});

	it('puts the player in front of the active building', () => {
		const a = AREAS.CONSTRUCTION;
		const player = dynamicLayer({ activeLine: 'CONSTRUCTION', eventLines: [], townTick: 0 }, 0).find((o) => o.sprite === 'player')!;
		expect(player.x + 8).toBe(a.x + a.w / 2);
	});

	it('blinks an event marker over the event line', () => {
		const at = (t: number) => dynamicLayer({ activeLine: null, eventLines: ['HUNTING'], townTick: 0 }, t).filter((o) => o.sprite === 'icon.event');
		expect(at(0)).toHaveLength(1);
		expect(at(0.5)).toHaveLength(0);
		expect(at(0)[0].x + 8).toBe(AREAS.HUNTING.x + AREAS.HUNTING.w / 2);
	});

	it('maps a tap to the building under it', () => {
		const r = AREAS.MEDICAL;
		expect(hitTest(r.x + 5, r.y + 5)).toBe('MEDICAL');
		expect(hitTest(1, H - 1)).toBeNull();
	});

	it('darkens only in the evening and at night', () => {
		expect([0, 1, 2, 3, 4].map(nightAlpha)).toEqual([0, 0, 0, 0, 0]);
		expect(nightAlpha(5)).toBeGreaterThan(0);
		expect(nightAlpha(7)).toBeGreaterThan(nightAlpha(5));
	});
});

describe('building upgrades in town', () => {
	it('adds one dormer per upgrade level', () => {
		const dormers = (lv: number) =>
			staticLayer({ HUNTING: lv }).filter((o) => o.sprite?.endsWith('.dormer') && o.y === AREAS.HUNTING.y && o.x >= AREAS.HUNTING.x && o.x < AREAS.HUNTING.x + AREAS.HUNTING.w);
		expect([0, 1, 2].map((lv) => dormers(lv).length)).toEqual([0, 1, 2]);
	});
});

describe('fame in town', () => {
	it('shows one gold dot per 30 fame, at most 3', () => {
		const dots = (f: number) => staticLayer({}, { ART: f }).filter((o) => o.rect && o.x >= AREAS.ART.x && o.x < AREAS.ART.x + AREAS.ART.w && o.y > AREAS.ART.y).length;
		expect([0, 29, 30, 65, 100].map(dots)).toEqual([0, 0, 1, 2, 3]);
	});
});
