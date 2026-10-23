/** 밸런스 회귀: 전체 규모(200명 × 300 활동시간) 경제 시뮬레이션. 시드당 약 2초. */
import { describe, expect, it } from 'vitest';
import { run } from './economy';

describe('balance', () => {
	it.each([1, 2, 3])('seed %i meets the economy targets', (seed) => {
		const r = run({ seed });
		expect(r.recovery, '회수율').toBeGreaterThanOrEqual(0.8);
		expect(r.reached('사업') / r.agents.length, '사업 도달 비율').toBeGreaterThanOrEqual(0.99);
		const med = r.medianHours('사업');
		expect(med).toBeGreaterThanOrEqual(100);
		expect(med).toBeLessThanOrEqual(160);
		expect(r.tierIncome('HOBBY')).toBeLessThan(r.tierIncome('JOB'));
		expect(r.tierIncome('JOB')).toBeLessThan(r.tierIncome('BUSINESS'));
	}, 60_000);
});

describe('balance with the workbench (daily limit)', () => {
	// 작업대 상시 임무 + 하루 3건 직접 수락한 의뢰 (실제 플레이 가정)
	it.each([1, 2, 3])('seed %i: business in 22-30 days, recovery kept', async (seed) => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		const r = run({
			seed,
			daily: { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: B.time.business_settlements_per_day, requestsPerDay: 3 }
		});
		expect(r.recovery, '회수율').toBeGreaterThanOrEqual(0.8);
		expect(r.reached('사업') / r.agents.length).toBeGreaterThanOrEqual(0.99);
		const days = r.medianDays('사업');
		expect(days).toBeGreaterThanOrEqual(22);
		expect(days).toBeLessThanOrEqual(30);
	}, 60_000);
});

describe('fame keeps light players moving', () => {
	it('one request a day still reaches business within 40 days', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		const r = run({
			seed: 1,
			daily: { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 1 }
		});
		expect(r.medianDays('CHIEF')).toBeLessThanOrEqual(35);
		expect(r.medianDays('사업')).toBeLessThanOrEqual(40);
	}, 60_000);
});

describe('long-run recovery with workers and building upgrades', () => {
	it('stays at 0.8 or above after 120 days', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		const r = run({
			seed: 1,
			daily: { days: 120, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 }
		});
		expect(r.recovery).toBeGreaterThanOrEqual(0.8);
	}, 120_000);
});

describe('new lines earn like the old ones', () => {
	it('art·music·sport income is within ±10% of the other lines', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const { PERFORMANCE_LINES } = await import('$lib/core/enums');
		const I = B.idle;
		const r = run({ seed: 2, daily: { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 } });
		const ratio = r.lineIncome(PERFORMANCE_LINES) / r.lineIncome(['TRANSPORT', 'HUNTING', 'CONSTRUCTION', 'MEDICAL', 'SECURITY']);
		expect(ratio).toBeGreaterThan(0.9);
		expect(ratio).toBeLessThan(1.1);
	}, 60_000);
});
