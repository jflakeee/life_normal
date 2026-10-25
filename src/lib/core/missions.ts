/** 임무 생성기 + 연계 이벤트 + 게시판.
 *  - 상시: 템플릿마다 항상 열려 있음
 *  - 의뢰: 게시판에 확률적으로 등록, 기한 있음, 빠른 완료 보너스
 *  - 돌발: 연계 이벤트가 발생시키고, 단계 완료 시 다음 계열 임무로 이어짐
 *  - 수집 임무 완료 시 도감 드롭 */
import { DROP_P, obtain, roll, type Drop } from './collection';
import { jobRewardMult } from './jobs';
import { addResearch, techDropMult, techRewardMult } from './research';
import B from './data/balance.json';
import M from './data/missions.json';
import { LINES, type Line, type MissionType, type Rank, type Tier } from './enums';
import { addFame, availableTo, completeMission, FAME_RULES, performanceBase, performanceOutcome, price, type MarketEntry, type Mission, type Outcome, type Player } from './model';
import { Rng, type RngState } from './rng';

const MB = B.missions;
export const QUEUE_LIMIT = MB.queue_limit;
export const REQUEST_DEADLINE = MB.request_deadline;
export const EMERGENCY_DEADLINE = MB.emergency_deadline;
export const CRIME_MULT_CAP = B.events.crime_mult_cap;
export const PLAYERS_PER_EVENT_UNIT = B.events.players_per_event_unit;
export const LOG_KEEP = 50;

// ── 템플릿 ──────────────────────────────────────────────
export interface MissionTemplate {
	id: string;
	name: string;
	line: Line;
	tier: Tier;
	type: MissionType;
	minRank: Rank | null;
	gear: number;
	yieldItem: string | null; // 채집형: 보상이 이 아이템 시세에 연동
	eventOnly: boolean; // 연계 이벤트에서만 등장
	process: Process | null; // 가공: 원자재를 사서 가공품으로 판다
	jobs: string[] | null; // 이 직종만 할 수 있음 (예: 철괴 제련은 대장장이)
	outlaw: boolean; // 무법 임무 (해적): 보상 ×1.6, 악명, 명성 없음
	research: number; // 완료하면 얻는 연구 점수 (과학자)
}

/** 가공: 원자재(input)를 사서 가공품(output)으로 판다. fuel이 있으면 연료값도 든다 */
export interface Process {
	input: string;
	output: string;
	fuel?: string;
}

type RawTemplate = { id: string; name: string; line: string; tier: string; type: string } & Partial<{
	min_rank: string;
	gear: number;
	yield_item: string;
	event_only: boolean;
	process: Process;
	jobs: string[];
	outlaw: boolean;
	research: number;
}>;

export const TEMPLATES: Record<string, MissionTemplate> = Object.fromEntries(
	(M.template as RawTemplate[]).map((t) => [
		t.id,
		{
			id: t.id,
			name: t.name,
			line: t.line as Line,
			tier: t.tier as Tier,
			type: t.type as MissionType,
			minRank: (t.min_rank as Rank) ?? null,
			gear: t.gear ?? 0,
			yieldItem: t.yield_item ?? null,
			eventOnly: t.event_only ?? false,
			process: t.process ?? null,
			jobs: t.jobs ?? null,
			outlaw: t.outlaw ?? false,
			research: t.research ?? 0
		}
	])
);

export interface ItemInfo {
	id: string;
	name: string;
	base: number;
	line: Line;
	from: string | null; // 가공품이면 원자재 id
}
type RawItem = { id: string; name: string; base_price: number; line: string; from?: string };
export const ITEMS: Record<string, ItemInfo> = Object.fromEntries(
	(M.item as RawItem[]).map((i) => [i.id, { id: i.id, name: i.name, base: i.base_price, line: i.line as Line, from: i.from ?? null }])
);

/** 저장된 시장에 새로 생긴 품목을 채운다 (이전 세이브 호환) */
export function fillMarket(market: Record<string, MarketEntry>): void {
	for (const [id, e] of Object.entries(defaultMarket())) market[id] ??= e;
}

export const defaultMarket = (): Record<string, MarketEntry> =>
	Object.fromEntries(Object.values(ITEMS).map((i) => [i.id, { base: i.base, supply: 10, demand: 10 }]));

// ── 효과 ────────────────────────────────────────────────
export type EffectKind = 'DEMAND' | 'SPAWN_BOOST' | 'BIZ_BONUS';
export interface Effect {
	kind: EffectKind;
	target: string; // DEMAND: 아이템 id, 나머지: Line
	value: number;
	duration: number;
}
const sameEffect = (a: Effect, b: Effect) =>
	a.kind === b.kind && a.target === b.target && a.value === b.value && a.duration === b.duration;

// ── 연계 이벤트 ─────────────────────────────────────────
export interface ChainStep {
	template: string;
	onStart: Effect[];
	onDone: Effect[];
}
export interface EventChain {
	id: string;
	name: string;
	baseP: number;
	crime: boolean;
	steps: ChainStep[];
}

type RawEffect = { kind: string; target: string; value: number; duration?: number };
type RawStep = { template: string; on_start?: RawEffect[]; on_done?: RawEffect[] };
const effect = (e: RawEffect): Effect => ({ kind: e.kind as EffectKind, target: e.target, value: e.value, duration: e.duration ?? 0 });

export const CHAINS: EventChain[] = M.chain.map((c) => ({
	id: c.id,
	name: c.name,
	baseP: c.base_p,
	crime: c.crime,
	steps: (c.step as RawStep[]).map((s) => ({
		template: s.template,
		onStart: (s.on_start ?? []).map(effect),
		onDone: (s.on_done ?? []).map(effect)
	}))
}));
export const CHAIN_BY_ID = Object.fromEntries(CHAINS.map((c) => [c.id, c]));

// ── 마을 상태 (순수 데이터) ─────────────────────────────
export interface World {
	market: Record<string, MarketEntry>;
	totalBusinesses: number;
	players: number;
	tick: number;
	active: { effect: Effect; until: number; source?: string }[]; // source: 그 효과를 건 연계 이벤트 (보도가 연장)
	bizBonus: Partial<Record<Line, number>>;
	policy?: string | null; // 지금 마을에 걸린 정책 (선거)
}
export interface Posting {
	mission: Mission;
	template: string;
	posted: number;
	deadline: number | null;
	chain: { id: string; step: number } | null;
	takenBy: string | null; // 수락한 플레이어 (타이머 진행 중에는 만료·중복 수락 없음)
	covers?: string; // 사건 취재: 이 연계 이벤트를 보도한다
}
export interface TownState {
	world: World;
	postings: Record<string, Posting>;
	nextId: number;
	log: string[];
	logTotal: number;
	rng: RngState;
}

export function newTown(seed: string | number, players = PLAYERS_PER_EVENT_UNIT): TownState {
	return {
		world: { market: defaultMarket(), totalBusinesses: 0, players, tick: 0, active: [], bizBonus: {} },
		postings: {},
		nextId: 1,
		log: [],
		logTotal: 0,
		rng: new Rng(seed).state
	};
}

export function chainChance(c: EventChain, w: World): number {
	const scale = w.players / PLAYERS_PER_EVENT_UNIT;
	const crime = c.crime ? Math.min(1 + B.events.crime_per_business * w.totalBusinesses, CRIME_MULT_CAP) : 1;
	// 정책: 축제 지원은 마을 축제 ×2, 치안 강화는 강도 사건 ×0.5
	const policy = c.id === 'festival' && w.policy === 'festival_support' ? 2 : c.crime && w.policy === 'public_safety' ? 0.5 : 1;
	return Math.min(c.baseP * scale * crime * policy, 1);
}

export function priceRatio(w: World, itemId: string): number {
	const e = w.market[itemId];
	return price(e) / e.base;
}

/** 가공 보상: (가공품 시세 − 원자재 시세 − 연료 시세) × 몫. 원자재·연료가 비싸지면 이윤이 줄고, 손해면 0 */
export function processReward(w: World, p: Process): number {
	const margin = price(w.market[p.output]) - price(w.market[p.input]) - (p.fuel ? price(w.market[p.fuel]) : 0);
	return Math.max(0, Math.round(margin * MB.process_share));
}

export function applyEffect(w: World, eff: Effect, source?: string): void {
	if (eff.kind === 'BIZ_BONUS') {
		const line = eff.target as Line;
		w.bizBonus[line] = (w.bizBonus[line] ?? 0) + eff.value;
		return;
	}
	const until = w.tick + eff.duration;
	const cur = w.active.find((a) => sameEffect(a.effect, eff));
	if (cur) {
		cur.until = Math.max(cur.until, until); // 같은 효과는 중첩하지 않고 기간만 연장
		return;
	}
	if (eff.kind === 'DEMAND') w.market[eff.target].demand *= eff.value;
	w.active.push({ effect: eff, until, source });
}

export function expireEffects(w: World): void {
	w.active = w.active.filter(({ effect, until }) => {
		if (w.tick < until) return true;
		if (effect.kind === 'DEMAND') w.market[effect.target].demand /= effect.value;
		return false;
	});
}

export function spawnMult(w: World, line: Line): number {
	return w.active
		.filter((a) => a.effect.kind === 'SPAWN_BOOST' && a.effect.target === line)
		.reduce((m, a) => m * a.effect.value, 1);
}

export function collectDrop(rng: Rng, p: Player, t: MissionTemplate): Drop | null {
	if (t.line !== 'COLLECTING' || rng.next() >= (DROP_P[t.type] ?? 0) * techDropMult(p)) return null;
	return obtain(p, roll(rng, p.skills.COLLECTING.level, t.type === 'REQUEST'));
}

export interface Completion {
	reward: number;
	drop: Drop | null;
	outcome: Outcome;
}

/** 마을 상태 위에서 동작하는 게시판. rng는 생성 시 상태에서 복원하고, save()로 되돌려 쓴다. */
export class Board {
	readonly rng: Rng;

	constructor(public town: TownState) {
		this.rng = Rng.restore(town.rng);
	}

	get world(): World {
		return this.town.world;
	}

	save(): TownState {
		this.town.rng = this.rng.state;
		return this.town;
	}

	private log(msg: string): void {
		this.town.log.push(msg);
		this.town.logTotal++;
		if (this.town.log.length > LOG_KEEP) this.town.log.splice(0, this.town.log.length - LOG_KEEP);
	}

	/** 현재 시세 기준 보상 (대기열 예약 시점에 고정) */
	rewardFor(templateId: string): number {
		const t = TEMPLATES[templateId];
		if (t.type === 'EMERGENCY' && t.tier === 'JOB') return MB.emergency_job_reward;
		if (t.process) return processReward(this.world, t.process);
		let r = MB.tier_base_reward[t.tier] * MB.type_mult[t.type] * performanceBase(t.line) * (t.outlaw ? B.outlaw.reward_mult : 1);
		if (t.yieldItem) r *= priceRatio(this.world, t.yieldItem);
		if (this.world.policy === 'public_safety' && t.line === 'SECURITY' && t.type === 'REQUEST') r *= 0.9; // 치안 강화의 대가
		return Math.round(r);
	}

	private post(t: MissionTemplate, deadline: number | null, chain: Posting['chain'] = null): Posting {
		const id = `${t.id}-${this.town.nextId++}`;
		const mission: Mission = { id, line: t.line, tier: t.tier, type: t.type, reward: this.rewardFor(t.id), minRank: t.minRank, gear: t.gear, jobs: t.jobs };
		const p: Posting = { mission, template: t.id, posted: this.world.tick, deadline, chain, takenBy: null };
		this.town.postings[id] = p;
		return p;
	}

	/** 상시 임무 인스턴스 (게시판에 남지 않음) */
	routine(templateId: string): Posting {
		const t = TEMPLATES[templateId];
		if (t.type !== 'ROUTINE') throw new Error(`${t.name}은(는) 상시 임무가 아님`);
		const p = this.post(t, null);
		delete this.town.postings[p.mission.id];
		return p;
	}

	startChain(chainId: string, step = 0): void {
		const chain = CHAIN_BY_ID[chainId];
		const s = chain.steps[step];
		for (const e of s.onStart) applyEffect(this.world, e, chainId);
		const t = TEMPLATES[s.template];
		const limit = t.type === 'EMERGENCY' ? EMERGENCY_DEADLINE : REQUEST_DEADLINE;
		this.post(t, this.world.tick + limit, { id: chainId, step });
		this.log(`[${String(this.world.tick).padStart(4)}] ${chain.name} ${step + 1}단계: ${t.name}`);
		if (step === 0 && TEMPLATES.news_coverage) {
			const cov = this.post(TEMPLATES.news_coverage, this.world.tick + REQUEST_DEADLINE);
			cov.covers = chainId;
		}
	}

	update(): void {
		const w = this.world;
		w.tick++;
		expireEffects(w);
		for (const [id, p] of Object.entries(this.town.postings)) {
			if (p.takenBy || p.deadline === null || w.tick <= p.deadline) continue;
			delete this.town.postings[id];
			if (p.chain) this.log(`[${String(w.tick).padStart(4)}] ${CHAIN_BY_ID[p.chain.id].name} 실패: ${TEMPLATES[p.template].name} 기한 초과`);
		}
		for (const line of LINES) {
			const open = Object.values(this.town.postings).filter(
				(p) => TEMPLATES[p.template].line === line && TEMPLATES[p.template].type === 'REQUEST'
			).length;
			if (open < MB.board_limit_per_line && this.rng.next() < MB.request_spawn_p * spawnMult(w, line)) {
				const pool = Object.values(TEMPLATES).filter((t) => t.line === line && t.type === 'REQUEST' && !t.eventOnly);
				this.post(this.rng.choice(pool), w.tick + REQUEST_DEADLINE);
			}
		}
		for (const c of CHAINS) if (this.rng.next() < chainChance(c, w)) this.startChain(c.id);
	}

	/** 보도: 그 사건이 건 효과를 1게임일 더 (기자 명성 50·90에서 2·3게임일) */
	extendCoverage(chainId: string, fame: number): void {
		const C = B.coverage;
		const days = 1 + C.fame_steps.filter((f) => fame >= f).length;
		for (const a of this.world.active) if (a.source === chainId) a.until += C.extend_ticks * days;
	}

	available(p: Player): Posting[] {
		return Object.values(this.town.postings).filter((x) => !x.takenBy && availableTo(x.mission, p));
	}

	accept(postingId: string, p: Player): Posting {
		const x = this.town.postings[postingId];
		if (!x || x.deadline === null) throw new Error('수락할 수 없는 임무');
		if (x.takenBy) throw new Error('이미 수락된 임무');
		if (!availableTo(x.mission, p)) throw new Error('조건 미충족');
		x.takenBy = p.id;
		return x;
	}

	complete(postingId: string, p: Player): Completion {
		const x = this.town.postings[postingId];
		if (!x || (x.takenBy && x.takenBy !== p.id) || !availableTo(x.mission, p)) throw new Error('조건 미충족');
		delete this.town.postings[postingId];
		const t = TEMPLATES[x.template];
		const fast = x.deadline !== null && this.world.tick - x.posted <= (x.deadline - x.posted) / 2;
		if (t.type === 'REQUEST' && fast) x.mission.reward = Math.round(x.mission.reward * (1 + MB.fast_bonus));
		const outcome = performanceOutcome(() => this.rng.next(), p, t.line, t.id); // 작품 품질, 경기 승패
		x.mission.reward = Math.round(x.mission.reward * outcome.mult * jobRewardMult(p, t.line, t.id) * techRewardMult(p, t));
		completeMission(x.mission, p);
		if (t.process && p.jobs[t.line]) p.jobs[t.line]!.processDone++;
		if (t.research) addResearch(p, t.research);
		if (x.covers) this.extendCoverage(x.covers, p.fame[t.line] ?? 0);
		if (outcome.fame) addFame(p, t.line, outcome.fame);
		// 명성: 의뢰 완료 +1, 기한 절반 안이면 +1, 연계 이벤트 단계 +3
		if (t.type === 'REQUEST' && !t.outlaw) addFame(p, t.line, FAME_RULES.request + (fast ? FAME_RULES.fast_bonus : 0)); // 무법 의뢰는 명성 대신 악명
		if (x.chain) addFame(p, t.line, FAME_RULES.chain_step);
		const drop = collectDrop(this.rng, p, t);
		if (x.chain) {
			const chain = CHAIN_BY_ID[x.chain.id];
			for (const e of chain.steps[x.chain.step].onDone) applyEffect(this.world, e, chain.id);
			if (x.chain.step + 1 < chain.steps.length) this.startChain(chain.id, x.chain.step + 1);
			else this.log(`[${String(this.world.tick).padStart(4)}] ${chain.name} 해결`);
		}
		return { reward: x.mission.reward, drop, outcome };
	}
}
