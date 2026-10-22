import { describe, expect, it } from 'vitest';
import { CATALOG, obtain, xpMult } from './collection';
import { Board, collectDrop, newTown, TEMPLATES } from './missions';
import { completeMission, gainXp, newPlayer } from './model';

describe('collection', () => {
	const hunting = Object.values(CATALOG).filter((c) => c.line === 'HUNTING').map((c) => c.id);

	it('a full line gives the maximum bonus', () => {
		expect(xpMult(hunting, 'HUNTING')).toBeCloseTo(1 + 0.02 * 5 + 0.1);
	});

	it('a duplicate is sold, not registered', () => {
		const p = newPlayer('p');
		const item = Object.values(CATALOG)[0];
		expect(obtain(p, item).registered).toBe(true);
		const d = obtain(p, item);
		expect(d.registered).toBe(false);
		expect(p.money).toBe(d.soldFor);
	});

	it('the xp bonus applies to missions', () => {
		const p = newPlayer('p');
		p.collection = [...hunting];
		gainXp(p, 'HUNTING', 50);
		expect(p.skills.HUNTING.xp).toBe(60);
	});

	it('collecting income stays near other hobbies', () => {
		// 회귀: 중복 판매로 수집 취미가 시간당 약 350 G를 벌던 문제. 목표: 기본 취미(100 G/h)의 1.3배 이하
		const board = new Board(newTown(1));
		const p = newPlayer('p');
		const n = 2_000;
		for (let i = 0; i < n; i++) {
			board.update();
			const x = board.routine('specimen');
			completeMission(x.mission, p);
			collectDrop(board.rng, p, TEMPLATES.specimen);
		}
		expect((p.money / n) * 20).toBeLessThanOrEqual(130);
	});
});
