import { describe, expect, it } from 'vitest';
import { transferMissing } from './jobs';
import { newPlayer } from './model';
import { addNotoriety, arrest, arrestChance, decayNotoriety, isBanned, isWanted, markChecked, OUTLAW } from './outlaw';

describe('outlaw (해적과 악명)', () => {
	it('notoriety rises, fades 20 a day, and makes you wanted at 30', () => {
		const p = newPlayer('p');
		addNotoriety(p, 40, 0);
		expect(isWanted(p)).toBe(true);
		decayNotoriety(p, 86_400 + 5);
		expect(p.notoriety!.value).toBe(20);
		expect(isWanted(p)).toBe(false);
		addNotoriety(p, 500, 86_400);
		expect(p.notoriety!.value).toBe(100);
	});

	it('the detective tries once a day, harder with more notoriety', () => {
		const p = newPlayer('p');
		addNotoriety(p, 20, 0);
		expect(arrestChance(p, '1')).toBe(0); // 수배 전
		addNotoriety(p, 80, 0);
		expect(arrestChance(p, '1')).toBeCloseTo(100 * OUTLAW.arrest_daily_per_point);
		markChecked(p, '1');
		expect(arrestChance(p, '1')).toBe(0); // 오늘은 이미 추적
		expect(arrestChance(p, '2')).toBeGreaterThan(0);
	});

	it('an arrest fines 15% (capped), cuts notoriety and bans pirate work for a day', () => {
		const rich = newPlayer('r', 100_000);
		addNotoriety(rich, 80, 0);
		expect(arrest(rich, 1000)).toBe(OUTLAW.fine_cap);
		expect(rich.notoriety!.value).toBe(30);
		expect(isBanned(rich, 1000 + 23 * 3600)).toBe(true);
		expect(isBanned(rich, 1000 + 25 * 3600)).toBe(false);
		const poor = newPlayer('q', 1_000);
		addNotoriety(poor, 80, 0);
		expect(arrest(poor, 0)).toBe(150);
	});

	it('a wanted pirate cannot wash their hands', () => {
		const p = newPlayer('p', 10_000);
		p.jobs.SEA = { job: 'pirate', rank: 'REGULAR', jobMissions: 0, requestsDone: 0, processDone: 0 };
		addNotoriety(p, 50, 0);
		expect(transferMissing(p, 'SEA', 'fisher', 0).join()).toContain('수배 중');
		p.notoriety!.value = 10;
		expect(transferMissing(p, 'SEA', 'fisher', 0)).toEqual([]);
	});
});
