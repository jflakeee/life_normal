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
	// 기존 계열끼리도 위험(부상) 여부에 따라 차이가 크다: 운송·건축·치료 260~274 G, 사냥 206 G, 보안 155 G
	// 그래서 예술·음악은 기존 계열 범위 안, 위험 계열인 운동은 사냥·보안 평균의 ±15% 안을 목표로 한다
	it('art·music stay inside the existing range, sport matches the other risky lines', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		const r = run({ seed: 2, daily: { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 } });
		const old = (['TRANSPORT', 'HUNTING', 'CONSTRUCTION', 'MEDICAL', 'SECURITY'] as const).map((l) => r.lineIncome([l]));
		for (const l of ['ART', 'MUSIC'] as const) {
			expect(r.lineIncome([l]), l).toBeGreaterThanOrEqual(Math.min(...old) * 0.95);
			expect(r.lineIncome([l]), l).toBeLessThanOrEqual(Math.max(...old) * 1.05);
		}
		const risky = (r.lineIncome(['HUNTING']) + r.lineIncome(['SECURITY'])) / 2;
		expect(r.lineIncome(['SPORT']) / risky).toBeGreaterThan(0.85);
		expect(r.lineIncome(['SPORT']) / risky).toBeLessThan(1.15);
	}, 60_000);
});

describe('upper jobs (직종)', () => {
	it('being able to transfer raises a line’s income by about 10~20%, economy unchanged', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		const daily = { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 };
		const off = run({ seed: 1, daily, transfers: false });
		const on = run({ seed: 1, daily, transfers: true });
		for (const l of ['TRANSPORT', 'CONSTRUCTION', 'MEDICAL'] as const) {
			const gain = on.lineIncome([l]) / off.lineIncome([l]) - 1;
			expect(gain, l).toBeGreaterThan(0.08);
			expect(gain, l).toBeLessThan(0.25);
		}
		expect(on.recovery).toBeGreaterThanOrEqual(0.8);
	}, 120_000);
});

describe('production lines (농업·광업·해양)', () => {
	it('farming sits in the safe range, mining and the sea match the other risky lines', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		const r = run({ seed: 1, daily: { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 } });
		const safe = (['TRANSPORT', 'CONSTRUCTION', 'MEDICAL', 'ART', 'MUSIC'] as const).map((l) => r.lineIncome([l]));
		expect(r.lineIncome(['AGRICULTURE'])).toBeGreaterThanOrEqual(Math.min(...safe) * 0.95);
		expect(r.lineIncome(['AGRICULTURE'])).toBeLessThanOrEqual(Math.max(...safe) * 1.05);
		const risky = (r.lineIncome(['HUNTING']) + r.lineIncome(['SECURITY']) + r.lineIncome(['SPORT'])) / 3;
		for (const l of ['MINING', 'SEA'] as const) {
			expect(r.lineIncome([l]) / risky, l).toBeGreaterThan(0.85);
			expect(r.lineIncome([l]) / risky, l).toBeLessThan(1.15);
		}
	}, 120_000);
});

describe('treasure hunter and pirate (해양 갈림길)', () => {
	it('both earn like the other risky lines; the pirate is caught about once a week', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		let pir = 0, th = 0, risky = 0, arrests = 0, n = 0;
		for (const seed of [1, 2]) {
			const r = run({ seed, daily: { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 } });
			risky += (r.lineIncome(['HUNTING']) + r.lineIncome(['SECURITY']) + r.lineIncome(['SPORT'])) / 3 / 2;
			th += r.jobIncome('treasure_hunter') / 2;
			const p = r.jobIncome('pirate');
			if (!Number.isNaN(p)) {
				pir += p;
				n++;
			}
			const ps = r.agents.filter((a) => a.p.jobs.SEA?.job === 'pirate');
			arrests += ps.reduce((s, a) => s + a.arrests, 0) / Math.max(1, ps.length) / 2;
		}
		for (const [name, v] of [['보물 사냥꾼', th], ['해적', pir / n]] as const) {
			expect(v / risky, name).toBeGreaterThan(0.85);
			expect(v / risky, name).toBeLessThan(1.15);
		}
		expect(arrests).toBeGreaterThan(3);
		expect(arrests).toBeLessThan(15);
	}, 180_000);
});

describe('knowledge (지식)', () => {
	it('sits in the safe range; scientists spend on research', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		const r = run({ seed: 1, daily: { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 } });
		const safe = (['TRANSPORT', 'CONSTRUCTION', 'MEDICAL', 'ART', 'MUSIC', 'AGRICULTURE'] as const).map((l) => r.lineIncome([l]));
		expect(r.lineIncome(['KNOWLEDGE'])).toBeGreaterThanOrEqual(Math.min(...safe) * 0.95);
		expect(r.lineIncome(['KNOWLEDGE'])).toBeLessThanOrEqual(Math.max(...safe) * 1.05);
		expect(r.ledger.sink['연구비']).toBeGreaterThan(0);
	}, 120_000);
});

describe('risk pay (위험 수당)', () => {
	it('risky lines net about the same as safe ones and reach a business within a few days of them', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const { RISK } = await import('$lib/core/model');
		const I = B.idle;
		const r = run({ seed: 1, daily: { days: 60, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 } });
		const safe = r.lineIncome(['TRANSPORT', 'CONSTRUCTION', 'MEDICAL', 'ART', 'MUSIC', 'AGRICULTURE', 'KNOWLEDGE', 'CIVIC']);
		const risky = r.lineIncome(RISK.lines as never);
		expect(risky / safe).toBeGreaterThan(0.9);
		expect(risky / safe).toBeLessThan(1.1);
		const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];
		const days = (isRisky: boolean) => med(r.agents.filter((a) => a.days['사업'] !== undefined && RISK.lines.includes(a.line) === isRisky).map((a) => a.days['사업']!));
		expect(Math.abs(days(true) - days(false))).toBeLessThanOrEqual(4);
	}, 120_000);

	it('even with the commerce-boost policy all 120 days, recovery stays at 0.8 or above', async () => {
		const { default: B } = await import('$lib/core/data/balance.json');
		const I = B.idle;
		const r = run({ seed: 1, bizTax: 0.27, daily: { days: 120, limit: I.daily_limit, full: I.daily_full, overRate: I.over_rate, settlementsPerDay: 10, requestsPerDay: 3 } });
		expect(r.recovery).toBeGreaterThanOrEqual(0.8);
	}, 180_000);
});
