import { describe, expect, it } from 'vitest';
import { LINES } from './enums';
import {
	applyEffect,
	Board,
	chainChance,
	CHAINS,
	CRIME_MULT_CAP,
	expireEffects,
	ITEMS,
	newTown,
	TEMPLATES
} from './missions';
import { newPlayer } from './model';

describe('missions', () => {
	it('has 33 templates', () => {
		expect(Object.keys(TEMPLATES)).toHaveLength(33);
	});

	it('every job has an entry-level routine mission', () => {
		// 회귀: 사냥·건축 견습이 의뢰만 기다리던 문제
		for (const line of LINES.filter((l) => l !== 'COLLECTING')) {
			const ok = Object.values(TEMPLATES).some((t) => t.line === line && t.tier === 'JOB' && t.type === 'ROUTINE' && !t.minRank);
			expect(ok, line).toBe(true);
		}
	});

	it('chains reference known data', () => {
		for (const c of CHAINS)
			for (const s of c.steps) {
				expect(TEMPLATES[s.template]).toBeDefined();
				for (const e of [...s.onStart, ...s.onDone]) if (e.kind === 'DEMAND') expect(ITEMS[e.target]).toBeDefined();
			}
	});

	it('the same effect does not stack', () => {
		// 회귀: 폭풍이 겹쳐 목재 수요가 계속 곱해지던 문제
		const w = newTown(1).world;
		const eff = { kind: 'DEMAND' as const, target: 'wood', value: 2.5, duration: 64 };
		applyEffect(w, eff);
		applyEffect(w, { ...eff });
		expect(w.market.wood.demand).toBe(25);
		w.tick = 1_000;
		expireEffects(w);
		expect(w.market.wood.demand).toBe(10);
	});

	it('crime multiplier is capped', () => {
		const robbery = CHAINS.find((c) => c.crime)!;
		const w = { ...newTown(1).world, totalBusinesses: 10_000 };
		expect(chainChance(robbery, w)).toBeCloseTo(robbery.baseP * CRIME_MULT_CAP);
	});

	it('a chain runs to resolution', () => {
		const board = new Board(newTown(0));
		const hero = newPlayer('hero');
		hero.equipment.push({ name: '중급', price: 1_500, durability: 1 });
		for (const l of LINES.filter((x) => x !== 'COLLECTING')) hero.jobs[l] = { rank: 'EXPERT', jobMissions: 0, requestsDone: 0 };
		board.startChain(CHAINS[0].id);
		for (let i = 0; i < CHAINS[0].steps.length; i++) {
			const posting = Object.values(board.town.postings).find((p) => p.chain)!;
			board.complete(posting.mission.id, hero);
		}
		expect(board.town.log.at(-1)).toMatch(/해결$/);
	});

	it('harvest reward follows the market price', () => {
		const board = new Board(newTown(0));
		const base = board.rewardFor('herb');
		applyEffect(board.world, { kind: 'DEMAND', target: 'herb', value: 2, duration: 40 });
		expect(board.rewardFor('herb')).toBeGreaterThan(base);
	});

	it('restores the same random sequence after save', () => {
		const a = new Board(newTown('s'));
		for (let i = 0; i < 50; i++) a.update();
		const saved = structuredClone(a.save());
		const b = new Board(saved);
		for (let i = 0; i < 100; i++) {
			a.update();
			b.update();
		}
		expect(b.save()).toEqual(a.save());
	});
});
