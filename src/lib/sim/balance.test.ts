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
