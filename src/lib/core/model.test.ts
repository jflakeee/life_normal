import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	businessUpkeep,
	canOpenBusiness,
	cumulativeXp,
	MAX_LEVEL,
	newPlayer,
	price,
	PRICE_CLAMP,
	promote,
	promoteMissing,
	RANK_REQ,
	addXp
} from './model';

describe('model', () => {
	it('xp curve matches the design', () => {
		expect(cumulativeXp(5)).toBe(1_703);
		expect(cumulativeXp(10)).toBe(11_106);
	});

	it('upkeep is progressive', () => {
		expect([0, 1, 2, 3].map((n) => Math.round(businessUpkeep(n)))).toEqual([0, 100, 283, 520]);
	});

	it('level never exceeds max', () => {
		fc.assert(
			fc.property(fc.array(fc.integer({ min: 0, max: 5_000 }), { maxLength: 50 }), (gains) => {
				const s = { level: 1, xp: 0 };
				for (const g of gains) {
					addXp(s, g);
					if (s.level < 1 || s.level > MAX_LEVEL) return false;
				}
				return true;
			})
		);
	});

	it('price stays inside the clamp', () => {
		fc.assert(
			fc.property(fc.double({ min: 0.01, max: 1e6, noNaN: true }), fc.double({ min: 0.01, max: 1e6, noNaN: true }), (supply, demand) => {
				const v = price({ base: 4, supply, demand });
				return v >= 4 * PRICE_CLAMP[0] - 1e-9 && v <= 4 * PRICE_CLAMP[1] + 1e-9;
			})
		);
	});

	it('promotion costs exactly the fee', () => {
		const req = RANK_REQ.REGULAR;
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 100_000 }), (extra) => {
				const p = newPlayer('p', req.fee + extra);
				p.skills.HUNTING.level = req.level;
				p.jobs.HUNTING = { job: '', processDone: 0, rank: 'APPRENTICE', jobMissions: req.job_missions, requestsDone: 0 };
				const before = p.money;
				return promote(p, 'HUNTING') === 'REGULAR' && before - p.money === req.fee;
			})
		);
	});

	it('promoteMissing lists every gap', () => {
		const p = newPlayer('p');
		p.jobs.HUNTING = { job: '', processDone: 0, rank: 'APPRENTICE', jobMissions: 0, requestsDone: 0 };
		const missing = promoteMissing(p, 'HUNTING').join(' ');
		for (const w of ['Lv', '자격 취득비', '직업 임무']) expect(missing).toContain(w);
	});

	it('business needs chief rank and capital', () => {
		const p = newPlayer('p', 1e9);
		p.jobs.HUNTING = { job: '', processDone: 0, rank: 'EXPERT', jobMissions: 0, requestsDone: 0 };
		expect(canOpenBusiness(p, 'HUNTING')).toBe(false);
		p.jobs.HUNTING!.rank = 'CHIEF';
		expect(canOpenBusiness(p, 'HUNTING')).toBe(true);
	});
});
