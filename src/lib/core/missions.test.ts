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
	it('has 63 templates (가공 4개, 새 계열 26개 포함)', () => {
		expect(Object.keys(TEMPLATES)).toHaveLength(63);
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
		for (const l of LINES.filter((x) => x !== 'COLLECTING')) hero.jobs[l] = { job: '', processDone: 0, rank: 'EXPERT', jobMissions: 0, requestsDone: 0 };
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

describe('processing', () => {
	it('pays half the margin between product and raw prices', () => {
		const board = new Board(newTown(0));
		// 기준가: 각재 10 − 목재 4 = 6 → 몫 0.5 → 3 G, 가죽 제품 30 − 가죽 12 = 18 → 9 G
		expect(board.rewardFor('process_lumber')).toBe(3);
		expect(board.rewardFor('process_leather')).toBe(9);
	});

	it('links to the market: dearer raw material shrinks the margin, product demand grows it', () => {
		const board = new Board(newTown(0));
		const base = board.rewardFor('process_medicine');
		applyEffect(board.world, { kind: 'DEMAND', target: 'herb', value: 2, duration: 40 });
		expect(board.rewardFor('process_medicine')).toBeLessThan(base);
		applyEffect(board.world, { kind: 'DEMAND', target: 'medicine', value: 1.5, duration: 40 });
		expect(board.rewardFor('process_medicine')).toBeGreaterThan(0);
	});

	it('never pays a negative reward', () => {
		const board = new Board(newTown(0));
		board.world.market.hide.demand = 1e6; // 원자재 폭등
		board.world.market.leather_goods.supply = 1e6; // 제품 폭락
		expect(board.rewardFor('process_leather')).toBe(0);
	});

	it('storm raises lumber demand along with wood', () => {
		const storm = CHAINS.find((c) => c.id === 'storm')!;
		expect(storm.steps[0].onStart.map((e) => e.target)).toEqual(expect.arrayContaining(['wood', 'lumber']));
	});

	it('fills new market items into an old save', async () => {
		const { fillMarket } = await import('./missions');
		const market = { wood: { base: 4, supply: 10, demand: 10 } };
		fillMarket(market as never);
		expect(Object.keys(market)).toEqual(expect.arrayContaining(['lumber', 'medicine', 'cut_meat', 'leather_goods']));
	});
});

describe('fame', () => {
	const hero = () => {
		const p = newPlayer('hero');
		p.equipment.push({ name: '중급', price: 1_500, durability: 1 });
		for (const l of LINES.filter((x) => x !== 'COLLECTING')) p.jobs[l] = { job: '', processDone: 0, rank: 'EXPERT', jobMissions: 0, requestsDone: 0 };
		return p;
	};

	it('a fast request gives +2 to that line, a chain step +3 more', () => {
		const board = new Board(newTown(0));
		const p = hero();
		board.startChain('beast'); // 1단계: 유해 동물 퇴치 (의뢰)
		const step = Object.values(board.town.postings).find((x) => x.chain)!;
		board.complete(step.mission.id, p);
		expect(p.fame.HUNTING).toBe(1 + 1 + 3);
		expect(p.fame.TRANSPORT).toBe(0);
	});

	it('is capped at 100', async () => {
		const { addFame } = await import('./model');
		const p = newPlayer('p');
		addFame(p, 'MEDICAL', 250);
		expect(p.fame.MEDICAL).toBe(100);
	});

	it('chief promotion needs fame 80 in that line', async () => {
		const { promoteMissing, RANK_REQ } = await import('./model');
		const p = newPlayer('p', 1e9);
		p.skills.SECURITY.level = 10;
		p.jobs.SECURITY = { job: '', processDone: 0, rank: 'EXPERT', jobMissions: 999, requestsDone: 999 };
		expect(promoteMissing(p, 'SECURITY').join()).toContain('명성 0/80');
		p.fame.SECURITY = RANK_REQ.CHIEF.fame;
		expect(promoteMissing(p, 'SECURITY')).toEqual([]);
	});
});

describe('performance lines (art, music, sport)', () => {
	it('every chain, old and new, runs to resolution', () => {
		for (const chain of CHAINS) {
			const board = new Board(newTown(1));
			const p = newPlayer('hero');
			p.equipment.push({ name: '중급', price: 1_500, durability: 1 });
			for (const l of LINES.filter((x) => x !== 'COLLECTING')) p.jobs[l] = { job: '', processDone: 0, rank: 'EXPERT', jobMissions: 0, requestsDone: 0 };
			board.startChain(chain.id);
			for (let i = 0; i < chain.steps.length; i++) {
				const step = Object.values(board.town.postings).find((x) => x.chain)!;
				board.complete(step.mission.id, p);
			}
			expect(board.town.log.at(-1), chain.name).toMatch(/해결$/);
		}
	});

	it('base reward is scaled per line, then grows with fame up to ×1.5', async () => {
		const { fameMult, rewardMult, PERFORMANCE } = await import('./model');
		const board = new Board(newTown(0));
		expect(board.rewardFor('busking')).toBe(Math.round(5 * PERFORMANCE.base_factor.MUSIC));
		const p = newPlayer('p');
		expect(fameMult(p, 'MUSIC')).toBe(1);
		p.fame.MUSIC = 50;
		expect(fameMult(p, 'MUSIC')).toBeCloseTo(1.25);
		p.fame.MUSIC = 100;
		expect(fameMult(p, 'MUSIC')).toBe(1.5);
		p.fame.TRANSPORT = 100;
		expect(rewardMult(p, 'TRANSPORT')).toBe(1); // 기존 계열은 명성과 무관
	});

	it('has 8 lines with buildings and 40 collectibles', async () => {
		const { CATALOG } = await import('./collection');
		expect(Object.keys(CATALOG)).toHaveLength(40);
		for (const l of ['ART', 'MUSIC', 'SPORT'] as const) expect(Object.values(CATALOG).filter((c) => c.line === l)).toHaveLength(5);
	});
});

describe('art quality and sport matches', () => {
	it('higher art level makes better works more likely', async () => {
		const { artChances } = await import('./model');
		const lo = artChances(1), hi = artChances(10);
		expect(hi.masterpiece).toBeGreaterThan(lo.masterpiece);
		expect(hi.great).toBeGreaterThan(lo.great);
		expect(hi.normal + hi.great + hi.masterpiece).toBeCloseTo(1);
	});

	it('a masterpiece pays 2.5× and adds fame; matches win more with level', async () => {
		const { performanceOutcome, matchWinChance } = await import('./model');
		const p = newPlayer('p');
		expect(performanceOutcome(() => 0, p, 'ART', 'street_sketch')).toEqual({ mult: 2.5, fame: 2, label: '걸작' });
		expect(performanceOutcome(() => 0.99, p, 'ART', 'street_sketch').label).toBeNull();
		expect(performanceOutcome(() => 0, p, 'SPORT', 'match').label).toBe('승리');
		expect(performanceOutcome(() => 0.99, p, 'SPORT', 'match').label).toBe('패배');
		expect(performanceOutcome(() => 0, p, 'SPORT', 'jogging').label).toBeNull(); // 훈련은 경기가 아니다
		expect(matchWinChance(10)).toBeGreaterThan(matchWinChance(1));
		expect(matchWinChance(100)).toBe(0.85);
	});
});
