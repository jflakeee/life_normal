import { describe, expect, it } from 'vitest';
import { ACTIONS, activeSpread, actionMissing, addActionXp, actionXpToNext, habitMult, habitStreak, recordHabit } from './actions';
import { newPlayer } from './model';

describe('daily actions (일상 행동)', () => {
	it('has 12 actions whose spread uses only lines that exist, summing to 1', () => {
		expect(Object.keys(ACTIONS)).toHaveLength(12);
		for (const id of Object.keys(ACTIONS)) {
			const s = activeSpread(id);
			expect(s.length, id).toBeGreaterThan(0);
			expect(s.reduce((t, [, w]) => t + w, 0), id).toBeCloseTo(1);
		}
		// 채집: 농업(아직 없음)을 빼고 치료·건축이 반반
		expect(Object.fromEntries(activeSpread('gather'))).toEqual({ MEDICAL: 0.5, CONSTRUCTION: 0.5 });
	});

	it('levels up faster than hobbies and reports missing requirements', () => {
		const p = newPlayer('p');
		expect(actionXpToNext(1)).toBe(50);
		expect(addActionXp(p, 'care', 50)).toBe(1);
		expect(actionMissing(p, { care: 3, observe: 2 })).toEqual(['돌보기 2/3', '관찰 1/2']);
	});

	it('a habit forms after 10 a day on consecutive days and breaks after a gap', () => {
		const p = newPlayer('p');
		const day = (d: number) => String(20000 + d);
		const doTen = (d: number) => {
			for (let i = 0; i < 10; i++) recordHabit(p, 'observe', day(d));
		};
		doTen(1);
		doTen(2);
		expect(habitMult(p, 'observe', day(2))).toBe(1); // 2일째: 아직
		doTen(3);
		expect(habitStreak(p, 'observe', day(3))).toBe(3);
		expect(habitMult(p, 'observe', day(3))).toBeCloseTo(1.1);
		for (let d = 4; d <= 7; d++) doTen(d);
		expect(habitMult(p, 'observe', day(7))).toBeCloseTo(1.2);
		expect(habitStreak(p, 'observe', day(9))).toBe(0); // 하루 넘게 비면 끊김 (벌칙 없음)
		doTen(9);
		expect(habitStreak(p, 'observe', day(9))).toBe(1);
		expect(habitStreak(p, 'observe', day(8))).toBe(0); // 기기 시계가 뒤로 가도 연속으로 치지 않는다
	});

	it('only the top 3 habits give a bonus', () => {
		const p = newPlayer('p');
		const ids = ['observe', 'talk', 'care', 'make'];
		for (let d = 1; d <= 3; d++) for (const [i, id] of ids.entries()) for (let k = 0; k < 10; k++) recordHabit(p, id, String(100 + d + (i === 3 ? 0 : 0)));
		p.habits!.make.streak = 1; // 가장 짧은 습관
		const active = ids.filter((id) => habitMult(p, id, '103') > 1);
		expect(active).toEqual(['observe', 'talk', 'care']);
	});
});
