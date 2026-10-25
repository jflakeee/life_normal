/** 데이터 모델과 규칙. 수치는 data/balance.json. 상태는 순수 데이터라 그대로 저장할 수 있다. */
import { xpMult } from './collection';
import B from './data/balance.json';
import { LINES, PERFORMANCE_LINES, RANKS, rankIndex, type Line, type MissionType, type Rank, type Tier } from './enums';

export class RuleError extends Error {}

// ── 밸런스 상수 ─────────────────────────────────────────
export const MAX_LEVEL = B.progression.max_level;
export const JOB_UNLOCK_LEVEL = B.progression.job_unlock_level;
export const MISSION_XP: Record<MissionType, number> = B.mission_xp;
export const JOB_BASE_PAY = B.job.base_pay_per_hour;
export const JOB_BONUS_PER_H = B.job.bonus_per_hour;
export const RANK_PAY_MULT: Record<Rank, number> = B.job.pay_mult;
export const MISSIONS_PER_DAY = B.time.missions_per_game_day;
export const MISSION_HOURS = B.time.mission_minutes / 60;
export const SALES_TAX = B.economy.sales_tax;
export const NPC_BUY_RATIO = B.economy.npc_buy_ratio;
export const PRICE_SENSITIVITY = B.economy.price_sensitivity;
export const PRICE_CLAMP = B.economy.price_clamp as [number, number];
export const REPAIR_RATE = B.economy.repair_rate;
export const DEATH_MONEY_LOSS = B.economy.death_money_loss;
export const DEATH_MEDICAL_FEE = B.economy.death_medical_fee;
export const DEATH_DURABILITY_LOSS = B.economy.death_durability_loss;
export const HOBBY_MEDICAL_DISCOUNT = B.economy.hobby_medical_discount;
export const INJURY_P = B.economy.injury_p;
export const DEATH_P = B.economy.death_p;
export const HOBBY_REWARD = B.economy.hobby_reward;
export const BUSINESS_OPEN_COST = B.business.open_cost;
export const BUSINESS_REVENUE = B.business.revenue_per_settlement;
export const BUSINESS_TAX = B.business.tax;
export const SHOP: Record<string, number> = B.shop;
/** 일꾼: 사업마다 최대 3명. 정산 매출 +25%/명, 정산마다 급여 */
export const WORKERS = { ...B.business.workers };
/** 건물 확장: 계열 건물 레벨 0~2, 그 계열 임무 보상 +5%/레벨 */
export const BUILDINGS_RULES = { costs: [...B.buildings.costs], reward_bonus: B.buildings.reward_bonus };

export interface RankRequirement {
	level: number;
	fee: number;
	job_missions: number;
	requests_done: number;
	fame: number; // 해당 계열 명성
}
export const RANK_REQ = B.rank_req as Record<Exclude<Rank, 'APPRENTICE'>, RankRequirement>;

export const xpToNext = (level: number) => Math.round(B.progression.xp_base * level ** B.progression.xp_exponent);

export function cumulativeXp(level: number): number {
	let s = 0;
	for (let lv = 1; lv < level; lv++) s += xpToNext(lv);
	return s;
}

/** 사업 n개의 정산 1회당 유지비 총액 (누진) */
export const businessUpkeep = (n: number) => (n ? B.business.upkeep_base * n ** B.business.upkeep_exponent : 0);

// ── 시장 ────────────────────────────────────────────────
export interface MarketEntry {
	base: number;
	supply: number;
	demand: number;
}

export function price(e: MarketEntry): number {
	const ratio = 1 + (PRICE_SENSITIVITY * (e.demand - e.supply)) / Math.max(e.supply, 1e-9);
	const [lo, hi] = PRICE_CLAMP;
	return e.base * Math.min(Math.max(ratio, lo), hi);
}

// ── 플레이어 ────────────────────────────────────────────
export interface SkillState {
	level: number;
	xp: number;
}
export interface JobState {
	rank: Rank;
	jobMissions: number;
	requestsDone: number;
}
export interface Equipment {
	name: string;
	price: number;
	durability: number;
}
export interface Player {
	id: string;
	money: number;
	fame: Record<Line, number>; // 계열별 명성 0~100
	skills: Record<Line, SkillState>;
	jobs: Partial<Record<Line, JobState>>;
	businesses: Line[];
	workers: number[]; // 사업마다 일꾼 수 (businesses와 같은 순서)
	buildings: Record<Line, number>; // 계열 건물 레벨
	equipment: Equipment[];
	collection: string[];
}

export function newPlayer(id: string, money = 0): Player {
	return {
		id,
		money,
		fame: Object.fromEntries(LINES.map((l) => [l, 0])) as Record<Line, number>,
		skills: Object.fromEntries(LINES.map((l) => [l, { level: 1, xp: 0 }])) as Record<Line, SkillState>,
		jobs: {},
		businesses: [],
		workers: [],
		buildings: Object.fromEntries(LINES.map((l) => [l, 0])) as Record<Line, number>,
		equipment: [],
		collection: []
	};
}

/** 명성 규칙 (계열별): 의뢰 완료, 빠른 완료, 연계 이벤트 단계 */
export const FAME_RULES = { ...B.fame };

export function addFame(p: Player, line: Line, n: number): void {
	p.fame[line] = Math.max(0, Math.min(FAME_RULES.max, (p.fame[line] ?? 0) + n));
}

export const hourlyPay = (job: JobState) => JOB_BASE_PAY * RANK_PAY_MULT[job.rank];
export const repairCost = (e: Equipment) => e.price * REPAIR_RATE;

/** 경험치 추가 후 오른 레벨 수 */
export function addXp(s: SkillState, amount: number): number {
	let gained = 0;
	s.xp += amount;
	while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) {
		s.xp -= xpToNext(s.level);
		s.level++;
		gained++;
	}
	if (s.level === MAX_LEVEL) s.xp = 0;
	return gained;
}

export const gainXp = (p: Player, line: Line, base: number) =>
	addXp(p.skills[line], Math.round(base * xpMult(p.collection, line)));

export const canTakeJob = (p: Player, line: Line) =>
	line !== 'COLLECTING' && p.skills[line].level >= JOB_UNLOCK_LEVEL;

export function takeJob(p: Player, line: Line): void {
	if (!canTakeJob(p, line)) throw new RuleError(`취미 Lv ${JOB_UNLOCK_LEVEL} 필요`);
	p.jobs[line] ??= { rank: 'APPRENTICE', jobMissions: 0, requestsDone: 0 };
}

/** 승급에 부족한 조건 목록 (비어 있으면 승급 가능) */
export function promoteMissing(p: Player, line: Line): string[] {
	const job = p.jobs[line];
	if (!job) return ['직업 없음'];
	if (job.rank === 'CHIEF') return ['최고 직급'];
	const req = RANK_REQ[RANKS[rankIndex(job.rank) + 1] as keyof typeof RANK_REQ];
	const checks: [number, number, string, string][] = [
		[p.skills[line].level, req.level, 'Lv', ''],
		[p.money, req.fee, '자격 취득비', ' G'],
		[job.jobMissions, req.job_missions, '직업 임무', '건'],
		[job.requestsDone, req.requests_done, '의뢰 완료', '건'],
		[p.fame[line], req.fame, '명성', '']
	];
	const n = (v: number) => Math.floor(v).toLocaleString('ko-KR');
	return checks.filter(([have, need]) => have < need).map(([have, need, name, unit]) => `${name} ${n(have)}/${n(need)}${unit}`);
}

export function promote(p: Player, line: Line): Rank {
	const missing = promoteMissing(p, line);
	if (missing.length) throw new RuleError('승급 조건 부족: ' + missing.join(', '));
	const job = p.jobs[line]!;
	const next = RANKS[rankIndex(job.rank) + 1] as keyof typeof RANK_REQ;
	p.money -= RANK_REQ[next].fee;
	job.rank = next;
	return next;
}

export const canOpenBusiness = (p: Player, line: Line) =>
	p.jobs[line]?.rank === 'CHIEF' && p.money >= BUSINESS_OPEN_COST;

export function openBusiness(p: Player, line: Line): void {
	if (!canOpenBusiness(p, line)) throw new RuleError('책임 직급과 자본이 필요합니다');
	p.money -= BUSINESS_OPEN_COST;
	p.businesses.push(line);
	p.workers.push(0);
}

export const upkeep = (p: Player) => businessUpkeep(p.businesses.length);

/** 정산 1회 매출 (u: 0.7~1.3 변동). 일꾼이 사업마다 매출을 올린다 */
export const settlementRevenue = (p: Player, u: number) =>
	BUSINESS_REVENUE * u * p.businesses.reduce((s, _, i) => s + 1 + WORKERS.revenue_bonus * (p.workers[i] ?? 0), 0);

export const workerWages = (p: Player) => WORKERS.wage * p.workers.reduce((a, b) => a + b, 0);

export function hireWorker(p: Player, index: number): void {
	if (index < 0 || index >= p.businesses.length) throw new RuleError('없는 사업입니다');
	if ((p.workers[index] ?? 0) >= WORKERS.max) throw new RuleError(`일꾼은 사업마다 ${WORKERS.max}명까지예요`);
	if (p.money < WORKERS.hire_cost) throw new RuleError(`고용비가 부족합니다 (${WORKERS.hire_cost.toLocaleString('ko-KR')} G)`);
	p.money -= WORKERS.hire_cost;
	p.workers[index] = (p.workers[index] ?? 0) + 1;
}

/** 다음 확장 비용 (최고 레벨이면 null) */
export const upgradeCost = (p: Player, line: Line): number | null => BUILDINGS_RULES.costs[p.buildings[line] ?? 0] ?? null;

export function upgradeBuilding(p: Player, line: Line): number {
	const cost = upgradeCost(p, line);
	if (cost === null) throw new RuleError('더 확장할 수 없어요');
	if (p.money < cost) throw new RuleError(`확장비가 부족합니다 (${cost.toLocaleString('ko-KR')} G)`);
	p.money -= cost;
	p.buildings[line] = (p.buildings[line] ?? 0) + 1;
	return p.buildings[line];
}

/** 예술·음악·운동: 기본 보상 배율과 명성 배율 (1 + 명성/100, 최대 ×2) */
export const PERFORMANCE = { ...B.performance, base_factor: { ...B.performance.base_factor } };
export const performanceBase = (line: Line) =>
	(PERFORMANCE.base_factor as Partial<Record<Line, number>>)[line] ?? 1; // 계열마다 따로 맞춘 기본 배율
export const fameMult = (p: Player, line: Line) =>
	PERFORMANCE_LINES.includes(line) ? Math.min(PERFORMANCE.max_mult, 1 + PERFORMANCE.per_fame * (p.fame[line] ?? 0)) : 1;

/** 예술 작품 품질·운동 경기 승패: 완료할 때 한 번 정해지고 보상 배율과 명성 보너스를 준다 */
export interface Outcome {
	mult: number;
	fame: number;
	label: string | null; // '걸작', '좋은 작품', '승리', '패배' (보통 작품은 null)
}
const AQ = B.art_quality;
const SM = B.sport_match;

/** 예술 레벨별 작품 품질 확률 */
export function artChances(level: number) {
	const masterpiece = AQ.masterpiece_base + AQ.masterpiece_per_lv * level;
	const great = AQ.great_base + AQ.great_per_lv * level;
	return { masterpiece, great, normal: 1 - masterpiece - great };
}

export const matchWinChance = (level: number) => Math.min(SM.win_max, SM.win_base + SM.win_per_lv * level);

/** rng: () => [0,1) */
export function performanceOutcome(next: () => number, p: Player, line: Line, templateId: string): Outcome {
	if (line === 'ART') {
		const c = artChances(p.skills.ART.level);
		const r = next();
		if (r < c.masterpiece) return { mult: AQ.mult.MASTERPIECE, fame: AQ.masterpiece_fame, label: '걸작' };
		if (r < c.masterpiece + c.great) return { mult: AQ.mult.GREAT, fame: 0, label: '좋은 작품' };
		return { mult: AQ.mult.NORMAL, fame: 0, label: null };
	}
	if (line === 'SPORT' && SM.templates.includes(templateId)) {
		return next() < matchWinChance(p.skills.SPORT.level)
			? { mult: SM.win_mult, fame: SM.win_fame, label: '승리' }
			: { mult: SM.lose_mult, fame: 0, label: '패배' };
	}
	return { mult: 1, fame: 0, label: null };
}

/** 건물 레벨에 따른 그 계열 임무 보상 배율 */
export const rewardMult = (p: Player, line: Line) =>
	(1 + BUILDINGS_RULES.reward_bonus * (p.buildings[line] ?? 0)) * fameMult(p, line);

export function onDeath(p: Player): number {
	const loss = Math.max(p.money, 0) * DEATH_MONEY_LOSS + DEATH_MEDICAL_FEE;
	p.money -= loss;
	for (const e of p.equipment) e.durability = Math.max(0, e.durability - DEATH_DURABILITY_LOSS);
	return loss;
}

// ── 임무 인스턴스 ───────────────────────────────────────
export interface Mission {
	id: string;
	line: Line;
	tier: Tier;
	type: MissionType;
	reward: number;
	minRank: Rank | null;
	gear: number;
}

export function availableTo(m: Mission, p: Player): boolean {
	if (m.tier === 'JOB') {
		const job = p.jobs[m.line];
		if (!job || (m.minRank && rankIndex(job.rank) < rankIndex(m.minRank))) return false;
	}
	if (m.tier === 'BUSINESS' && !p.businesses.includes(m.line)) return false;
	return m.gear === 0 || p.equipment.some((e) => e.price >= m.gear);
}

export function completeMission(m: Mission, p: Player): void {
	p.money += m.reward;
	gainXp(p, m.line, MISSION_XP[m.type]);
	if (m.tier === 'JOB') {
		const job = p.jobs[m.line]!;
		job.jobMissions++;
		if (m.type === 'REQUEST') job.requestsDone++;
	}
}
