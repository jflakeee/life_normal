import { describe, expect, it } from 'vitest';
import { clock, gold, xpToNext } from './format';

describe('format', () => {
	it('matches the server xp curve', () => {
		expect([1, 2, 3, 4].map((l) => xpToNext(l))).toEqual([100, 283, 520, 800]);
	});
	it('formats timers and gold', () => {
		expect(clock(161)).toBe('2:41');
		expect(clock(-5)).toBe('0:00');
		expect(gold(30000)).toBe('30,000 G');
	});
});
