import { describe, expect, it } from 'vitest';
import { LINES } from '$lib/core/enums';
import { BUILDINGS, SPRITES } from './atlas';
import { AREAS, DISTRICT_OF, DISTRICTS, dynamicLayer, H, hitTest, nightAlpha, staticLayer, W, type District } from './scene';

const SHEET_SIZE = { town: [192, 176], player: [16, 16], npc: [16, 16] } as const;
const inDistrict = (d: District) => LINES.filter((l) => DISTRICT_OF[l] === d);

describe('pixel atlas', () => {
	it('every sprite lies inside its sheet', () => {
		for (const [name, s] of Object.entries(SPRITES)) {
			const [w, h] = SHEET_SIZE[s.sheet];
			expect(s.x + s.w <= w && s.y + s.h <= h, name).toBe(true);
		}
	});

	it('every line has a building (or the forest) in exactly one district', () => {
		for (const line of LINES) {
			expect(AREAS[line], line).toBeDefined();
			expect(DISTRICTS).toContain(DISTRICT_OF[line]);
		}
		expect(Object.keys(BUILDINGS)).toHaveLength(LINES.length - 1); // 수집은 숲
	});
});

describe('pixel scene (districts)', () => {
	it('areas fit the scene and do not overlap inside a district', () => {
		for (const d of DISTRICTS) {
			const rs = inDistrict(d).map((l) => AREAS[l]);
			for (const r of rs) expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, d).toBe(true);
			for (let i = 0; i < rs.length; i++)
				for (let j = i + 1; j < rs.length; j++) {
					const [a, b] = [rs[i], rs[j]];
					expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, d).toBe(false);
				}
		}
	});

	it('each district only draws its own buildings, with known sprites', () => {
		for (const d of DISTRICTS) {
			const ops = staticLayer(d);
			for (const op of ops) if (op.sprite) expect(SPRITES[op.sprite], op.sprite).toBeDefined();
			for (const l of LINES.filter((x) => x !== 'COLLECTING')) {
				const icon = ops.some((o) => o.sprite === BUILDINGS[l].icon && o.x === AREAS[l].x + 8 && o.y === AREAS[l].y + 10);
				expect(icon, `${d} ${l}`).toBe(DISTRICT_OF[l] === d);
			}
		}
	});

	it('puts the player in front of the active building only in its district', () => {
		const a = AREAS.MINING;
		const at = (d: District) => dynamicLayer({ activeLine: 'MINING', eventLines: [], townTick: 0 }, 0, d).find((o) => o.sprite === 'player')!;
		expect(at('field').x + 8).toBe(a.x + a.w / 2);
		expect(at('harbor').x + 8).not.toBe(a.x + a.w / 2); // 다른 구역에서는 길을 걷는다 (t=0이면 x=8)
	});

	it('blinks an event marker only in the district of the event', () => {
		const at = (t: number, d: District) =>
			dynamicLayer({ activeLine: null, eventLines: ['HUNTING'], townTick: 0 }, t, d).filter((o) => o.sprite === 'icon.event');
		expect(at(0, 'field')).toHaveLength(1);
		expect(at(0.5, 'field')).toHaveLength(0);
		expect(at(0, 'center')).toHaveLength(0);
	});

	it('maps a tap to the building under it in the visible district', () => {
		const r = AREAS.MEDICAL;
		expect(hitTest(r.x + 5, r.y + 5, 'center')).toBe('MEDICAL');
		expect(hitTest(r.x + 5, r.y + 5, 'field')).toBe(DISTRICT_OF.AGRICULTURE === 'field' ? 'AGRICULTURE' : null);
		expect(hitTest(1, H - 1, 'center')).toBeNull();
	});

	it('darkens only in the evening and at night', () => {
		expect([0, 1, 2, 3, 4].map(nightAlpha)).toEqual([0, 0, 0, 0, 0]);
		expect(nightAlpha(5)).toBeGreaterThan(0);
		expect(nightAlpha(7)).toBeGreaterThan(nightAlpha(5));
	});
});

describe('building upgrades and fame in town', () => {
	it('adds one dormer per upgrade level', () => {
		const dormers = (lv: number) =>
			staticLayer('field', { HUNTING: lv }).filter(
				(o) => o.sprite?.endsWith('.dormer') && o.y === AREAS.HUNTING.y && o.x >= AREAS.HUNTING.x && o.x < AREAS.HUNTING.x + AREAS.HUNTING.w
			);
		expect([0, 1, 2].map((lv) => dormers(lv).length)).toEqual([0, 1, 2]);
	});

	it('shows one gold dot per 30 fame, at most 3', () => {
		const dots = (f: number) =>
			staticLayer('center', {}, { ART: f }).filter((o) => o.rect?.color === '#f2c335' && o.x >= AREAS.ART.x && o.x < AREAS.ART.x + AREAS.ART.w).length;
		expect([0, 29, 30, 65, 100].map(dots)).toEqual([0, 0, 1, 2, 3]);
	});
});
