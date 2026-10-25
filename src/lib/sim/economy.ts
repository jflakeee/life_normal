/** 경제 시뮬레이션: 플레이어 N명이 취미 → 직업 → 사업으로 성장하며 회수율과 계층 수입을 잰다.
 *  1틱 = 임무 1건(3분, 활동량 기준). 사업 정산은 임무 8건당 1회
 *  (모바일 기준: 하루 80건 플레이 · 하루 정산 10회와 같은 비율). */
import { LINES, rankIndex, type Line, type MissionType, type Rank, type Tier } from '$lib/core/enums';
import { Board, newTown, priceRatio, processReward, TEMPLATES } from '$lib/core/missions';
import {
	addFame,
	BUSINESS_OPEN_COST,
	hireWorker,
	jobTransferFee,
	transferJob,
	performanceBase,
	performanceOutcome,
	rewardMult,
	settlementRevenue,
	upgradeBuilding,
	upgradeCost,
	workerWages,
	WORKERS,
	BUSINESS_REVENUE,
	BUSINESS_TAX,
	businessUpkeep,
	canOpenBusiness,
	canTakeJob,
	DEATH_MONEY_LOSS,
	DEATH_P,
	FAME_RULES,
	availableTo,
	gainXp,
	HOBBY_MEDICAL_DISCOUNT,
	HOBBY_REWARD,
	hourlyPay,
	INJURY_P,
	JOB_BONUS_PER_H,
	MISSION_HOURS,
	MISSION_XP,
	MISSIONS_PER_DAY,
	newPlayer,
	openBusiness,
	promote,
	promoteMissing,
	RANK_REQ,
	REPAIR_RATE,
	SALES_TAX,
	takeJob,
	upkeep,
	type Player
} from '$lib/core/model';
import { Rng } from '$lib/core/rng';
import { jobPayMult, jobRewardMult, jobsOf, transferMissing } from '$lib/core/jobs';

const REQUEST_PROB = 0.4; // 플레이어가 의뢰를 고르는 비율 (행동 가정)
const GEAR_BY_RANK: Partial<Record<Rank, number>> = { APPRENTICE: 200, EXPERT: 1_500, CHIEF: 6_000 };
const RISKY: Line[] = ['HUNTING', 'SECURITY', 'SPORT'];
const MAX_BUSINESSES = 10;
const EVENT_TAKE_P = 0.5;
const YIELD_ITEMS: Partial<Record<Line, string[]>> = { CONSTRUCTION: ['wood', 'stone'], MEDICAL: ['herb'], HUNTING: ['meat', 'hide'] };
const PROCESS_TEMPLATES: Partial<Record<Line, (typeof TEMPLATES)[string][]>> = {};
for (const t of Object.values(TEMPLATES)) if (t.process) (PROCESS_TEMPLATES[t.line] ??= []).push(t);
const REFERENCE_WORLD = newTown(0).world; // 이벤트 없는 실행에서 쓰는 기준 시세

export const MILESTONES = ['직업', 'REGULAR', 'EXPERT', 'CHIEF', '사업'] as const;

export class Ledger {
	src: Record<string, number> = {};
	sink: Record<string, number> = {};
	earn(k: string, v: number) {
		this.src[k] = (this.src[k] ?? 0) + v;
	}
	spend(k: string, v: number) {
		this.sink[k] = (this.sink[k] ?? 0) + v;
	}
	get recovery(): number {
		const s = Object.values(this.src).reduce((a, b) => a + b, 0);
		return Object.values(this.sink).reduce((a, b) => a + b, 0) / Math.max(s, 1e-9);
	}
}

interface Agent {
	p: Player;
	line: Line;
	milestones: Partial<Record<(typeof MILESTONES)[number], number>>;
	days: Partial<Record<(typeof MILESTONES)[number], number>>;
	income: Record<Tier, { sum: number; n: number }>;
	bizDue: number;
	jobIncome: Record<string, { sum: number; n: number }>;
}

export interface Params {
	players: number;
	hours: number;
	seed: number;
	events: boolean;
	expand: boolean;
	bizPerMission: number;
	repairRate: number;
	bizTax: number;
	/** 하루 단위 모드 (작업대): 날마다 limit건, full건 이후 보상률 overRate. hours 대신 days만큼 돈다 */
	daily: { days: number; limit: number; full: number; overRate: number; settlementsPerDay: number; requestsPerDay?: number } | null;
	/** 상위 직종으로 전직하는 행동 */
	transfers: boolean;
	/** 사업 뒤 지출 행동 (일꾼, 건물 확장) */
	sinks: { workers: boolean; buildings: boolean };
	/** 현재 날짜 (하루 단위 모드에서 내부용) */
	day: number;
}

export const DEFAULT_PARAMS: Params = {
	players: 200,
	hours: 300,
	seed: 1,
	events: true,
	expand: true,
	bizPerMission: 1 / MISSIONS_PER_DAY,
	repairRate: REPAIR_RATE,
	bizTax: BUSINESS_TAX,
	daily: null,
	sinks: { workers: true, buildings: true },
	transfers: true,
	day: 0
};

export interface Result {
	agents: Agent[];
	ledger: Ledger;
	board: Board | null;
	recovery: number;
	reached(m: (typeof MILESTONES)[number]): number;
	medianHours(m: (typeof MILESTONES)[number]): number;
	medianDays(m: (typeof MILESTONES)[number]): number;
	tierIncome(t: Tier): number;
	/** 직종별 직업 순수입 평균 (사업 전) */
	jobIncome(jobId: string): number;
	/** 계열 묶음별 취미·직업 순수입 평균 (사업 전) */
	lineIncome(lines: readonly Line[]): number;
}

function median(xs: number[]): number {
	if (!xs.length) return NaN;
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function tick(a: Agent, t: number, led: Ledger, rng: Rng, prm: Params, board: Board | null, rate = 1, forced?: MissionType) {
	const { p, line } = a;
	const hours = t * MISSION_HOURS;
	const before = p.money;
	let job = p.jobs[line];
	const mtype: MissionType = forced ?? (rng.next() < REQUEST_PROB ? 'REQUEST' : 'ROUTINE');
	let tier: Tier;
	// 예술 작품 품질, 운동 경기 승패 (경기는 의뢰일 때)
	const outcome = performanceOutcome(() => rng.next(), p, line, mtype === 'REQUEST' ? 'match' : 'routine');
	if (outcome.fame) addFame(p, line, outcome.fame);

	// 1) 활동 수입 + 경험치
	if (!job) {
		let gross = HOBBY_REWARD * rng.uniform(0.7, 1.3) * rate * rewardMult(p, line) * performanceBase(line) * outcome.mult;
		const items = YIELD_ITEMS[line];
		if (board && items) gross *= items.reduce((s, i) => s + priceRatio(board.world, i), 0) / items.length;
		const tax = gross * SALES_TAX;
		p.money += gross - tax;
		led.earn('취미 판매', gross);
		led.spend('판매세', tax);
		tier = 'HOBBY';
	} else {
		// 성과급: 일반 직업 임무(평균 5 G) 또는, 더 낫다면 가공 이윤 (플레이어는 이득인 쪽을 고른다)
		let bonus = JOB_BONUS_PER_H * rng.uniform(0.5, 1.5) * MISSION_HOURS;
		const world = board?.world ?? REFERENCE_WORLD;
		let processed = false;
		for (const t of PROCESS_TEMPLATES[line] ?? []) {
			const rankOk = !t.minRank || rankIndex(job.rank) >= rankIndex(t.minRank);
			const gearOk = t.gear === 0 || p.equipment.some((e) => e.price >= t.gear);
			const r = processReward(world, t.process!) * jobRewardMult(p, line, t.id);
			if (rankOk && gearOk && r > bonus) {
				bonus = r;
				processed = true;
			}
		}
		if (processed) job.processDone++;
		const pay = (hourlyPay(job) * MISSION_HOURS + bonus * rewardMult(p, line) * performanceBase(line) * outcome.mult) * rate;
		p.money += pay;
		led.earn('직업 급여', pay);
		job.jobMissions++;
		if (mtype === 'REQUEST') job.requestsDone++;
		tier = 'JOB';
	}
	gainXp(p, line, Math.round(MISSION_XP[mtype] * rate));
	// 직접 수락한 의뢰는 3분 만에 끝나므로 늘 기한 절반 안 (빠른 완료)
	if (mtype === 'REQUEST') addFame(p, line, FAME_RULES.request + FAME_RULES.fast_bonus);

	// 2) 위험
	if (RISKY.includes(line)) {
		if (rng.next() < DEATH_P) {
			const loss = Math.max(p.money, 0) * DEATH_MONEY_LOSS + 300;
			p.money -= loss;
			led.spend('사망 손실+치료', loss);
		} else if (rng.next() < INJURY_P) {
			const fee = rng.int(50, 300) * (job ? 1 : HOBBY_MEDICAL_DISCOUNT);
			p.money -= fee;
			led.spend('치료비', fee);
		}
	}

	// 3) 활동량 정산 (임무 8건마다 수리)
	if (t % MISSIONS_PER_DAY === 0 && p.equipment.length) {
		const c = Math.max(...p.equipment.map((e) => e.price)) * prm.repairRate;
		p.money -= c;
		led.spend('장비 수리', c);
	}
	if (p.businesses.length) {
		a.bizDue += prm.bizPerMission;
		while (a.bizDue >= 1) {
			a.bizDue -= 1;
			const rev = settlementRevenue(p, rng.uniform(0.7, 1.3));
			const up = upkeep(p);
			const tax = rev * prm.bizTax;
			const wage = workerWages(p);
			p.money += rev - up - tax - wage;
			led.earn('사업 매출', rev);
			led.spend('사업 유지비', up);
			led.spend('사업 매출세', tax);
			if (wage) led.spend('일꾼 급여', wage);
		}
	}
	if (job && !p.businesses.length) {
		const jb = (a.jobIncome[job.job] ??= { sum: 0, n: 0 });
		jb.sum += (p.money - before) / MISSION_HOURS;
		jb.n++;
	}
	const bucket = a.income[p.businesses.length ? 'BUSINESS' : tier];
	bucket.sum += (p.money - before) / MISSION_HOURS;
	bucket.n++;

	// 4) 성장 결정
	if (!job && canTakeJob(p, line)) {
		takeJob(p, line);
		a.milestones['직업'] = hours;
		a.days['직업'] = prm.day;
		job = p.jobs[line];
	}
	if (job) {
		const gear = GEAR_BY_RANK[job.rank];
		if (gear && !p.equipment.some((e) => e.price === gear) && p.money >= gear) {
			p.money -= gear;
			p.equipment.push({ name: `gear${gear}`, price: gear, durability: 1 });
			led.spend('장비 구매', gear);
		}
		if (promoteMissing(p, line).length === 0) {
			const r = promote(p, line) as keyof typeof RANK_REQ;
			led.spend('자격 취득비', RANK_REQ[r].fee);
			a.milestones[r] = hours;
			a.days[r] = prm.day;
		}
		// 조건이 되면 급여가 더 높은 상위 직종으로 전직 (여윳돈이 있을 때)
		for (const target of prm.transfers ? jobsOf(line).filter((j) => j.pay_mult > jobPayMult(job!.job)) : []) {
			const fee = jobTransferFee(p, line, target.id);
			if (transferMissing(p, line, target.id, fee).length === 0 && p.money >= fee + 2_000) {
				transferJob(p, line, target.id);
				led.spend('전직', fee);
				break;
			}
		}
		const n = p.businesses.length;
		const marginal = BUSINESS_REVENUE * (1 - prm.bizTax) - (businessUpkeep(n + 1) - businessUpkeep(n));
		if (canOpenBusiness(p, line) && (n === 0 || (prm.expand && marginal > 0 && n < MAX_BUSINESSES))) {
			openBusiness(p, line);
			led.spend('사업 개설', BUSINESS_OPEN_COST);
			a.milestones['사업'] ??= hours;
			a.days['사업'] ??= prm.day;
		}
		// 사업 뒤의 지출: 일꾼 고용(이득이면), 건물 확장 (여윳돈이 있으면)
		if (p.businesses.length && prm.sinks.workers) {
			const i = p.workers.findIndex((w) => w < WORKERS.max);
			const gain = BUSINESS_REVENUE * WORKERS.revenue_bonus * (1 - prm.bizTax) - WORKERS.wage;
			if (i >= 0 && gain > 0 && p.money >= WORKERS.hire_cost + 1_000) {
				hireWorker(p, i);
				led.spend('일꾼 고용', WORKERS.hire_cost);
			}
		}
		if (p.businesses.length && prm.sinks.buildings) {
			const cost = upgradeCost(p, line);
			if (cost !== null && p.money >= cost + 2_000) {
				upgradeBuilding(p, line);
				led.spend('건물 확장', cost);
			}
		}
	}
}

function resolveEvents(agents: Agent[], board: Board, led: Ledger, rng: Rng) {
	for (const x of Object.values(board.town.postings).filter((p) => p.chain)) {
		if (!board.town.postings[x.mission.id] || rng.next() > EVENT_TAKE_P) continue;
		const cands = agents.filter((a) => availableTo(x.mission, a.p));
		if (cands.length) led.earn('돌발 임무', board.complete(x.mission.id, rng.choice(cands).p).reward);
	}
}

function payBizBonus(agents: Agent[], board: Board, led: Ledger) {
	for (const [line, bonus] of Object.entries(board.world.bizBonus) as [Line, number][]) {
		const owners = agents.filter((a) => a.p.businesses.includes(line));
		if (!owners.length) continue;
		for (const a of owners) a.p.money += bonus / owners.length;
		led.earn('이벤트 사업 보너스', bonus);
		delete board.world.bizBonus[line];
	}
}

export function run(over: Partial<Params> = {}): Result {
	const prm = { ...DEFAULT_PARAMS, ...over };
	if (prm.daily) prm.day = 1;
	const rng = new Rng(prm.seed);
	const led = new Ledger();
	const lines = LINES.filter((l) => l !== 'COLLECTING');
	const agents: Agent[] = Array.from({ length: prm.players }, (_, i) => ({
		p: newPlayer(`p${i}`),
		line: rng.choice(lines),
		milestones: {},
		days: {},
		income: { HOBBY: { sum: 0, n: 0 }, JOB: { sum: 0, n: 0 }, BUSINESS: { sum: 0, n: 0 } },
		bizDue: 0,
		jobIncome: {}
	}));
	const board = prm.events ? new Board(newTown(prm.seed + 1, prm.players)) : null;
	const daily = prm.daily;
	// 하루 단위 모드: 작업대 상시 임무 limit건 + 직접 수락한 의뢰 requestsPerDay건 (의뢰는 한도에 들지 않음)
	const reqs = daily?.requestsPerDay;
	const perDay = daily ? daily.limit + (reqs ?? 0) : 0;
	if (daily) prm.bizPerMission = daily.settlementsPerDay / perDay;
	const ticks = daily ? daily.days * perDay : Math.round(prm.hours / MISSION_HOURS);
	for (let t = 1; t <= ticks; t++) {
		let rate = 1;
		let forced: MissionType | undefined;
		if (daily) {
			prm.day = Math.floor((t - 1) / perDay) + 1;
			const i = (t - 1) % perDay;
			if (reqs !== undefined && i < reqs) forced = 'REQUEST';
			else {
				const j = i - (reqs ?? 0);
				rate = j < daily.full ? 1 : daily.overRate;
				if (reqs !== undefined) forced = 'ROUTINE';
			}
		}
		if (board) {
			board.world.totalBusinesses = agents.reduce((n, a) => n + a.p.businesses.length, 0);
			board.update();
			resolveEvents(agents, board, led, rng);
			if (t % MISSIONS_PER_DAY === 0) payBizBonus(agents, board, led);
		}
		for (const a of agents) tick(a, t, led, rng, prm, board, rate, forced);
	}
	return {
		agents,
		ledger: led,
		board,
		recovery: led.recovery,
		reached: (m) => agents.filter((a) => a.milestones[m] !== undefined).length,
		medianHours: (m) => median(agents.flatMap((a) => (a.milestones[m] !== undefined ? [a.milestones[m]!] : []))),
		medianDays: (m) => median(agents.flatMap((a) => (a.days[m] !== undefined ? [a.days[m]!] : []))),
		jobIncome: (id) => {
			const b = agents.reduce((s, a) => ({ sum: s.sum + (a.jobIncome[id]?.sum ?? 0), n: s.n + (a.jobIncome[id]?.n ?? 0) }), { sum: 0, n: 0 });
			return b.n ? b.sum / b.n : NaN;
		},
		lineIncome: (ls) => {
			let sum = 0,
				n = 0;
			for (const a of agents.filter((x) => ls.includes(x.line)))
				for (const t of ['HOBBY', 'JOB'] as Tier[]) {
					sum += a.income[t].sum;
					n += a.income[t].n;
				}
			return n ? sum / n : NaN;
		},
		tierIncome: (t) => {
			const b = agents.reduce((s, a) => ({ sum: s.sum + a.income[t].sum, n: s.n + a.income[t].n }), { sum: 0, n: 0 });
			return b.n ? b.sum / b.n : NaN;
		}
	};
}

export function report(res: Result, title: string): string {
	const out = [`=== ${title} ===`];
	for (const m of MILESTONES)
		out.push(`${m.padEnd(8)} 도달 ${String(res.reached(m)).padStart(3)}/${res.agents.length}명, 중앙값 ${res.medianHours(m).toFixed(1)}h`);
	out.push(`회수율 ${res.recovery.toFixed(3)}`);
	for (const t of ['HOBBY', 'JOB', 'BUSINESS'] as Tier[]) out.push(`${t.padEnd(8)} 순수입 평균 ${res.tierIncome(t).toFixed(0)} G/활동h`);
	return out.join('\n');
}
