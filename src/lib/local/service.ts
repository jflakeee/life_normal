/** 게임 서비스: 브라우저 안에서 서버 역할을 한다 (저장소는 localStorage).
 *  - 임무 타이머는 돌리지 않는다. 시작·종료 시각만 저장하고 조회·수령 때 비교한다(지연 평가)
 *  - 마을 틱도 지연 평가: 조회·명령이 올 때 지난 시간만큼 게시판을 진행시킨다
 *  - 명령은 Idempotency-Key로 한 번만 처리되고, 실패하면 통째로 되돌린다
 *  - 돈은 반드시 ledger 기록과 함께 바뀐다 */
import { progress } from '$lib/core/collection';
import B from '$lib/core/data/balance.json';
import { LINE_NAME, LINES, type Line } from '$lib/core/enums';
import { Board, CHAINS, collectDrop, fillMarket, ITEMS, newTown, priceRatio, TEMPLATES, type MissionTemplate, type TownState } from '$lib/core/missions';
import {
	availableTo,
	BUSINESS_OPEN_COST,
	BUSINESS_REVENUE,
	BUSINESS_TAX,
	gainXp,
	DEATH_P,
	HOBBY_MEDICAL_DISCOUNT,
	hourlyPay,
	INJURY_P,
	MISSION_HOURS,
	MISSION_XP,
	MISSIONS_PER_DAY,
	newPlayer,
	onDeath,
	openBusiness as coreOpenBusiness,
	price,
	promote as corePromote,
	promoteMissing,
	repairCost,
	REPAIR_RATE,
	RuleError,
	SALES_TAX,
	SHOP,
	takeJob as coreTakeJob,
	upkeep,
	type Player
} from '$lib/core/model';
import { Rng } from '$lib/core/rng';
import * as wb from './workbench';

type Json = Record<string, unknown>;

const CHAIN_NAMES = Object.fromEntries(CHAINS.map((c) => [c.id, c.name]));
const ITEM_NAMES = Object.fromEntries(Object.values(ITEMS).map((i) => [i.id, i.name]));

export const TICK_SECONDS = B.time.mission_minutes * 60;
export const SETTLE_CAP = B.time.business_settlements_per_day;
export const SETTLE_INTERVAL = 86_400 / SETTLE_CAP;
const MAX_CATCHUP_TICKS = 480; // 오래 비어 있던 마을은 하루치까지만 따라잡는다
const START_MONEY = 100;
const IDEMPOTENCY_TTL = 86_400;
const IDEMPOTENCY_KEEP = 200;
const LEDGER_RECENT = 200;
const RISKY: Line[] = ['HUNTING', 'SECURITY'];
export const SAVE_VERSION = 5; // v4: 대기열 → 작업대, v5: 평판 → 계열별 명성

/** 플레이어에게 그대로 보여 줄 수 있는 규칙 위반 (HTTP 409에 해당) */
export class GameError extends Error {}

export interface Run {
	id: number;
	template: string;
	source: 'queue' | 'board';
	postingId: string | null;
	reward: number;
	startedAt: number;
	endsAt: number;
}

export interface LedgerEntry {
	kind: string;
	amount: number;
	ref: string | null;
	at: number;
}

export interface SaveData {
	version: number;
	token: string;
	player: Player;
	town: TownState;
	townLastTick: number;
	runs: Run[];
	nextRunId: number;
	missionsDone: number;
	bizLast: number | null;
	ledger: { totals: Record<string, number>; recent: LedgerEntry[] };
	idem: Record<string, { response: unknown; at: number }>;
	workbench: wb.Workbench;
	lastActive: number; // 마지막 접속 (오프라인 진행 상한 기준)
}

export function newSave(now: number, seed: string): SaveData {
	const token = `local-${seed}`;
	const s: SaveData = {
		version: SAVE_VERSION,
		token,
		player: newPlayer(token, START_MONEY),
		town: newTown(`town-${seed}`, 1),
		townLastTick: now,
		runs: [],
		nextRunId: 1,
		missionsDone: 0,
		bizLast: null,
		ledger: { totals: { grant: START_MONEY }, recent: [] },
		idem: {},
		workbench: wb.newWorkbench(now),
		lastActive: now
	};
	return s;
}

/** 한 명령이 다루는 작업용 사본 */
export class Session {
	readonly board: Board;

	constructor(
		readonly d: SaveData,
		readonly now: number,
		readonly tz = 0 // 기기 시간대 (Date#getTimezoneOffset, 분)
	) {
		this.board = new Board(d.town);
		const n = Math.floor((now - d.townLastTick) / TICK_SECONDS);
		for (let i = 0; i < Math.min(n, MAX_CATCHUP_TICKS); i++) this.board.update();
		d.townLastTick += n * TICK_SECONDS;
		wb.advance(d.workbench, wb.unlockedSlots(d.player), now, d.lastActive, TICK_SECONDS, tz);
		d.lastActive = now;
	}

	get p(): Player {
		return this.d.player;
	}

	ledger(kind: string, amount: number, ref: string | null = null): void {
		if (!amount) return;
		const l = this.d.ledger;
		l.totals[kind] = (l.totals[kind] ?? 0) + amount;
		l.recent.push({ kind, amount, ref, at: this.now });
		if (l.recent.length > LEDGER_RECENT) l.recent.splice(0, l.recent.length - LEDGER_RECENT);
	}

	/** 돈을 바꾸고 기록한다 (음수 = 지출) */
	pay(kind: string, amount: number, ref: string | null = null): void {
		this.p.money += amount;
		this.ledger(kind, amount, ref);
	}

	/** 코어 함수가 직접 바꾼 돈의 변화를 기록한다 */
	track<T>(kind: string, ref: string | null, fn: () => T): T {
		const before = this.p.money;
		const out = fn();
		this.ledger(kind, this.p.money - before, ref);
		return out;
	}

	finish(): SaveData {
		this.d.town = this.board.save();
		this.d.town.world.totalBusinesses = this.p.businesses.length;
		return this.d;
	}
}

function rule<T>(fn: () => T): T {
	try {
		return fn();
	} catch (e) {
		if (e instanceof RuleError || e instanceof Error) throw new GameError(e.message);
		throw e;
	}
}

function line(name: string): Line {
	const l = name.toUpperCase() as Line;
	if (!LINES.includes(l)) throw new GameError(`알 수 없는 계열: ${name}`);
	return l;
}

// ── 조회 ─────────────────────────────────────────────
const openRuns = (s: Session) => [...s.d.runs].sort((a, b) => a.endsAt - b.endsAt || a.id - b.id);

export function pendingSettlements(s: Session): number {
	if (!s.p.businesses.length || s.d.bizLast === null) return 0;
	return Math.min(SETTLE_CAP, Math.floor((s.now - s.d.bizLast) / SETTLE_INTERVAL));
}

export function state(s: Session): Json {
	const p = s.p;
	const runs = openRuns(s).map((r) => ({
		id: r.id,
		template: r.template,
		name: TEMPLATES[r.template].name,
		source: r.source,
		reward: r.reward,
		ends_at: r.endsAt,
		done: r.endsAt <= s.now
	}));
	return {
		now: s.now,
		money: Math.round(p.money * 100) / 100,
		fame: p.fame,
		skills: p.skills,
		jobs: Object.fromEntries(
			Object.entries(p.jobs).map(([l, j]) => [
				l,
				{ rank: j!.rank, job_missions: j!.jobMissions, requests_done: j!.requestsDone, missing: promoteMissing(p, l as Line) }
			])
		),
		equipment: p.equipment.map((e) => e.name),
		businesses: p.businesses,
		pending_settlements: pendingSettlements(s),
		queue: runs,
		workbench: workbenchState(s),
		claimable: runs.filter((r) => r.done).length + s.d.workbench.slots.reduce((n, x) => n + x.pending.length, 0),
		town_tick: s.board.world.tick
	};
}

export function board(s: Session): Json {
	const t = s.board.world.tick;
	const postings = Object.values(s.d.town.postings)
		.filter((x) => x.deadline !== null && (!x.takenBy || x.takenBy === s.p.id))
		.map((x) => ({
			id: x.mission.id,
			name: TEMPLATES[x.template].name,
			line: x.mission.line,
			type: x.mission.type,
			reward: x.mission.reward,
			deadline_ticks: x.deadline! - t,
			chain: x.chain ? (CHAIN_NAMES[x.chain.id] ?? x.chain.id) : null,
			available: availableTo(x.mission, s.p),
			accepted: x.takenBy === s.p.id
		}))
		.sort((a, b) => Number(a.chain === null) - Number(b.chain === null) || a.deadline_ticks - b.deadline_ticks);
	return { postings, events: s.d.town.log.slice(-10) };
}

export function market(s: Session): Json {
	return Object.fromEntries(
		Object.entries(s.board.world.market).map(([k, e]) => [
			k,
			{ name: ITEM_NAMES[k], base: e.base, price: Math.round(price(e) * 100) / 100, from: ITEMS[k]?.from ?? null }
		])
	);
}

export function collection(s: Session): Json {
	return Object.fromEntries(
		progress(s.p.collection).map((x) => [x.line, { owned: x.owned, total: x.total, xp_mult: Math.round(x.mult * 100) / 100 }])
	);
}

export function catalog(): Json {
	return {
		lines: LINE_NAME,
		templates: Object.values(TEMPLATES)
			.filter((t) => !t.eventOnly)
			.map((t) => ({
				id: t.id,
				name: t.name,
				line: t.line,
				tier: t.tier,
				type: t.type,
				min_rank: t.minRank,
				gear: t.gear,
				process: t.process && { input: ITEM_NAMES[t.process.input], output: ITEM_NAMES[t.process.output] }
			})),
		shop: SHOP,
		repair_rate: REPAIR_RATE,
		slots_max: wb.SLOTS_MAX,
		daily_limit: wb.DAILY_LIMIT,
		mission_seconds: TICK_SECONDS,
		business: { open_cost: BUSINESS_OPEN_COST, revenue: BUSINESS_REVENUE, tax: BUSINESS_TAX, settlements_per_day: SETTLE_CAP }
	};
}

/** 알림: cursor(구독별 상태)를 갱신하며 그 사이 생긴 일을 돌려준다 */
export function notifications(s: Session, cursor: Json): Json[] {
	const events: Json[] = [];
	const since = (cursor.checkedAt as number) ?? s.now;
	const pending = s.d.workbench.slots.flatMap((x) => x.pending);
	const done =
		s.d.runs.filter((r) => r.endsAt > since && r.endsAt <= s.now).length +
		pending.filter((w) => w.at > since && w.at <= s.now).length;
	if (done) {
		const resting = wb.usedToday(s.d.workbench, s.now, s.tz) >= wb.DAILY_LIMIT;
		events.push({ type: 'mission.done', count: done, resting });
	}
	const seen = (cursor.logTotal as number) ?? s.d.town.logTotal;
	const fresh = s.d.town.logTotal - seen;
	for (const ln of fresh > 0 ? s.d.town.log.slice(-fresh) : []) {
		const text = ln.split('] ').slice(1).join('] ');
		events.push({ type: text.includes('1단계') ? 'event.started' : 'event.step', text });
	}
	const prices = JSON.stringify(Object.keys(s.board.world.market).map((k) => priceRatio(s.board.world, k).toFixed(4)));
	if (cursor.prices !== undefined && cursor.prices !== prices) events.push({ type: 'market.changed' });
	const full = pendingSettlements(s) >= SETTLE_CAP;
	if (full && !cursor.settlementFull) events.push({ type: 'settlement.ready' });
	Object.assign(cursor, { checkedAt: s.now, logTotal: s.d.town.logTotal, prices, settlementFull: full });
	return events;
}

// ── 임무 ─────────────────────────────────────────────
export function workbenchState(s: Session): Json {
	const w = s.d.workbench;
	const open = wb.unlockedSlots(s.p);
	return {
		slots: w.slots.map((x, i) => ({
			index: i,
			unlocked: i < open,
			template: x.template,
			name: x.template ? TEMPLATES[x.template].name : null,
			line: x.template ? TEMPLATES[x.template].line : null,
			pending: x.pending.length,
			next_in: x.template ? TICK_SECONDS - x.progress : null,
			tap_left: x.template ? wb.TAP_MAX_PER_RUN - x.tapUsed : 0
		})),
		used_today: wb.usedToday(w, s.now, s.tz),
		limit: wb.DAILY_LIMIT,
		full: wb.DAILY_FULL,
		over_rate: wb.OVER_RATE,
		resets_at: wb.nextDayStart(s.now, s.tz),
		offline_cap_hours: wb.OFFLINE_CAP / 3600
	};
}

function slotAt(s: Session, index: number): wb.Slot {
	if (!Number.isInteger(index) || index < 0 || index >= wb.unlockedSlots(s.p))
		throw new GameError('열리지 않은 작업대입니다');
	return s.d.workbench.slots[index];
}

/** 작업대에 상시 임무를 올린다 (이미 있던 일은 바뀐다. 끝난 작업은 그대로 받을 수 있다) */
export function setWork(s: Session, index: number, templateId: string): Json {
	const slot = slotAt(s, index);
	const t = TEMPLATES[templateId];
	if (!t || t.type !== 'ROUTINE') throw new GameError('작업대에는 상시 임무만 올릴 수 있습니다');
	const probe = { id: 'probe', line: t.line, tier: t.tier, type: t.type, reward: 0, minRank: t.minRank, gear: t.gear };
	if (!availableTo(probe, s.p)) throw new GameError('조건 미충족 (직업 또는 장비)');
	Object.assign(slot, { template: templateId, progress: 0, lastTick: s.now, tapUsed: 0 });
	return { slot: index, template: templateId, name: t.name };
}

export function stopWork(s: Session, index: number): Json {
	const slot = slotAt(s, index);
	Object.assign(slot, { template: null, progress: 0, tapUsed: 0 });
	return { slot: index, stopped: true };
}

export function tapWork(s: Session, index: number): Json {
	const slot = slotAt(s, index);
	const r = wb.tap(slot, s.d.workbench, s.now, TICK_SECONDS, s.tz);
	if (r === 'empty') throw new GameError('비어 있는 작업대입니다');
	if (r === 'limit') throw new GameError('이번 작업은 더 당길 수 없어요');
	return { slot: index, next_in: TICK_SECONDS - slot.progress, tap_left: wb.TAP_MAX_PER_RUN - slot.tapUsed };
}

export function accept(s: Session, postingId: string): Json {
	if (s.d.runs.some((r) => r.source === 'board')) throw new GameError('의뢰·돌발은 한 번에 하나만 진행할 수 있습니다');
	const x = rule(() => s.board.accept(postingId, s.p));
	const id = s.d.nextRunId++;
	s.d.runs.push({ id, template: x.template, source: 'board', postingId, reward: x.mission.reward, startedAt: s.now, endsAt: s.now + TICK_SECONDS });
	return { run_id: id, ends_at: s.now + TICK_SECONDS };
}

/** 끝난 작업 한 건을 정산한다: 보상, 경험치, 도감, 세금·급여, 위험, 수리 */
function settle(s: Session, t: MissionTemplate, ref: string, rng: Rng, how: { reward: number; rate: number } | { postingId: string }): Json {
	const p = s.p;
	const before = p.money;
	let drop;
	let rate = 1;
	if ('postingId' in how) {
		drop = s.board.complete(how.postingId, p).drop;
	} else {
		rate = how.rate;
		p.money += how.reward;
		gainXp(p, t.line, Math.round(MISSION_XP[t.type] * rate));
		if (t.tier === 'JOB') {
			const job = p.jobs[t.line]!;
			job.jobMissions++;
			if (t.type === 'REQUEST') job.requestsDone++;
		}
		drop = collectDrop(rng, p, t);
	}
	const sold = drop?.soldFor ?? 0;
	const gained = p.money - before - sold; // 의뢰 빠른 완료 보너스 포함
	s.ledger('mission_reward', gained, ref);
	s.ledger('collection_sale', sold, ref);
	const item: Json = { name: t.name, reward: gained, rate };
	if (t.tier === 'HOBBY') s.pay('sales_tax', -gained * SALES_TAX, ref);
	else if (t.tier === 'JOB' && p.jobs[t.line]) {
		const pay = hourlyPay(p.jobs[t.line]!) * MISSION_HOURS * rate;
		s.pay('job_pay', pay, ref);
		item.pay = Math.round(pay * 100) / 100;
	}
	if (drop) item.drop = { name: drop.item.name, registered: drop.registered, sold_for: sold };
	Object.assign(item, risk(s, rng, t.line, t.tier === 'HOBBY', ref));
	s.d.missionsDone++;
	if (s.d.missionsDone % MISSIONS_PER_DAY === 0 && p.equipment.length)
		s.pay('repair', -Math.max(...p.equipment.map(repairCost)), ref);
	return item;
}

export function claim(s: Session): Json {
	const p = s.p;
	const results: Json[] = [];
	// 작업대: 끝난 순서대로
	const work = s.d.workbench.slots
		.flatMap((slot, i) => slot.pending.map((w) => ({ ...w, slot: i })))
		.sort((a, b) => a.at - b.at || a.slot - b.slot);
	for (const w of work) {
		const t = TEMPLATES[w.template];
		const ref = `work:${w.slot}:${w.at}`;
		const reward = Math.round(s.board.rewardFor(w.template) * w.rate);
		results.push(settle(s, t, ref, new Rng(`${p.id}:${ref}`), { reward, rate: w.rate }));
	}
	for (const slot of s.d.workbench.slots) slot.pending = [];
	// 의뢰·돌발 (그리고 v3 세이브에서 넘어온 대기열 임무)
	for (const r of openRuns(s)) {
		if (r.endsAt > s.now) continue;
		s.d.runs = s.d.runs.filter((x) => x.id !== r.id);
		const t = TEMPLATES[r.template];
		const ref = `run:${r.id}`;
		const rng = new Rng(`${p.id}:${r.id}`);
		if (r.source === 'board') {
			if (!r.postingId || !s.d.town.postings[r.postingId]) {
				results.push({ run: r.id, name: t.name, expired: true });
				continue;
			}
			results.push({ run: r.id, ...settle(s, t, ref, rng, { postingId: r.postingId }) });
		} else {
			results.push({ run: r.id, ...settle(s, t, ref, rng, { reward: r.reward, rate: 1 }) });
		}
	}
	return { claimed: results, money: Math.round(p.money * 100) / 100 };
}

function risk(s: Session, rng: Rng, l: Line, hobby: boolean, ref: string): Json {
	if (!RISKY.includes(l)) return {};
	if (rng.next() < DEATH_P) {
		s.track('death', ref, () => onDeath(s.p));
		return { incident: 'death' };
	}
	if (rng.next() < INJURY_P) {
		const fee = rng.int(50, 300) * (hobby ? HOBBY_MEDICAL_DISCOUNT : 1);
		s.pay('medical', -fee, ref);
		return { incident: 'injury', medical_fee: fee };
	}
	return {};
}

// ── 성장 ─────────────────────────────────────────────
export function takeJob(s: Session, lineName: string): Json {
	const l = line(lineName);
	rule(() => coreTakeJob(s.p, l));
	return { job: l, rank: s.p.jobs[l]!.rank };
}

export function promote(s: Session, lineName: string): Json {
	const l = line(lineName);
	const rank = rule(() => s.track('rank_fee', l, () => corePromote(s.p, l)));
	return { job: l, rank };
}

export function buy(s: Session, item: string): Json {
	const cost = SHOP[item];
	if (cost === undefined) throw new GameError('없는 상품');
	if (s.p.money < cost) throw new GameError(`돈이 부족합니다 (${cost.toLocaleString('ko-KR')} G)`);
	s.pay('shop', -cost, item);
	s.p.equipment.push({ name: item, price: cost, durability: 1 });
	return { bought: item, money: Math.round(s.p.money * 100) / 100 };
}

// ── 사업 ─────────────────────────────────────────────
export function openBusiness(s: Session, lineName: string): Json {
	const l = line(lineName);
	if (s.p.businesses.length) collect(s); // 사업 수가 바뀌기 전에 밀린 정산부터
	rule(() => s.track('business_open', l, () => coreOpenBusiness(s.p, l)));
	s.d.bizLast ??= s.now;
	return { businesses: s.p.businesses };
}

export function collect(s: Session): Json {
	const pending = pendingSettlements(s);
	if (!pending || s.d.bizLast === null) return { settled: 0 };
	const p = s.p;
	const n = p.businesses.length;
	const rng = new Rng(`${p.id}:biz:${s.d.bizLast}`);
	let total = 0;
	for (let i = 0; i < pending; i++) {
		const rev = BUSINESS_REVENUE * n * rng.uniform(0.7, 1.3);
		s.pay('business_revenue', rev);
		s.pay('business_tax', -rev * BUSINESS_TAX);
		s.pay('business_upkeep', -upkeep(p));
		total += rev * (1 - BUSINESS_TAX) - upkeep(p);
	}
	for (const l of new Set(p.businesses)) {
		const bonus = s.board.world.bizBonus[l] ?? 0;
		delete s.board.world.bizBonus[l];
		s.pay('event_bonus', bonus, l);
		total += bonus;
	}
	const capped = s.now - s.d.bizLast >= SETTLE_CAP * SETTLE_INTERVAL;
	s.d.bizLast = capped ? s.now : s.d.bizLast + pending * SETTLE_INTERVAL;
	return { settled: pending, net: Math.round(total * 100) / 100, money: Math.round(p.money * 100) / 100 };
}

// ── 점검 ─────────────────────────────────────────────
/** ledger 합계와 실제 돈이 맞는지 (어긋나면 차이를 돌려준다) */
export function audit(d: SaveData): number {
	const sum = Object.values(d.ledger.totals).reduce((a, b) => a + b, 0);
	return Math.abs(sum - d.player.money) < 1e-6 ? 0 : d.player.money - sum;
}

// ── 세이브 이동 ──────────────────────────────────────
const SAVE_KIND = 'life_normal.save';

export function exportSave(d: SaveData): string {
	return JSON.stringify({ kind: SAVE_KIND, exportedAt: new Date().toISOString(), data: d });
}

/** 가져올 세이브를 검사한다. 문제가 있으면 GameError, 정상이면 SaveData */
export function parseSave(raw: string): SaveData {
	let doc: { kind?: string; data?: SaveData };
	try {
		doc = JSON.parse(raw);
	} catch {
		throw new GameError('세이브 파일을 읽을 수 없습니다');
	}
	const d = doc?.data && migrateSave(doc.data);
	if (doc?.kind !== SAVE_KIND || !d) throw new GameError('동네 임무 세이브 파일이 아닙니다');
	if (d.version !== SAVE_VERSION) throw new GameError(`지원하지 않는 세이브 버전입니다 (v${d.version})`);
	const shape = d.player?.skills && d.town?.world && Array.isArray(d.runs) && d.ledger?.totals && Array.isArray(d.town?.rng);
	if (!shape) throw new GameError('세이브 파일이 손상되었습니다');
	if (audit(d) !== 0) throw new GameError('세이브의 돈 기록이 맞지 않습니다');
	return normalizeSave(d);
}

/** 이전 버전 세이브를 지금 버전으로 바꾼다 (진행을 잃지 않게) */
export function migrateSave(d: SaveData): SaveData {
	if (d.version === 3) {
		// v3의 대기열 임무는 runs에 그대로 남아 예전처럼 받을 수 있다
		d.workbench = wb.newWorkbench(d.townLastTick);
		d.lastActive = d.townLastTick;
		d.version = 4;
	}
	if (d.version === 4) {
		// 평판(전체 의뢰 수) → 계열별 명성: 그 계열에서 끝낸 의뢰 수로 시작 (진행을 잃지 않게)
		const p = d.player as Player & { reputation?: number };
		p.fame = Object.fromEntries(LINES.map((l) => [l, Math.min(100, p.jobs[l]?.requestsDone ?? 0)])) as Player['fame'];
		delete p.reputation;
		d.version = 5;
	}
	return d;
}

/** 이전 세이브에 없는 새 데이터(시장 품목 등)를 채운다 */
export function normalizeSave(d: SaveData): SaveData {
	fillMarket(d.town.world.market);
	return d;
}

// ── 실행 틀 ──────────────────────────────────────────
export interface Store {
	load(): SaveData | null;
	save(d: SaveData): void;
}

export class LocalGame {
	private d: SaveData;

	constructor(
		private store: Store,
		private clock: () => number = () => Date.now() / 1000,
		seed: string = Math.random().toString(36).slice(2),
		/** 기기 시간대 (하루 한도의 새벽 4시 기준). 테스트에서는 고정값을 넣는다 */
		private tz: () => number = () => new Date().getTimezoneOffset()
	) {
		const saved = store.load();
		if (saved) migrateSave(saved);
		this.d = saved && saved.version === SAVE_VERSION ? normalizeSave(saved) : newSave(this.clock(), seed);
		this.store.save(this.d);
	}

	get token(): string {
		return this.d.token;
	}

	get data(): SaveData {
		return this.d;
	}

	/** 검사를 통과한 세이브로 바꾼다. 실패하면 지금 진행은 그대로 */
	replace(d: SaveData): void {
		this.d = structuredClone(d);
		this.store.save(this.d);
	}

	reset(seed: string = Math.random().toString(36).slice(2)): void {
		this.replace(newSave(this.clock(), seed));
	}

	/** 조회도 마을 틱을 진행시키므로 사본에서 실행한 뒤 반영한다 */
	query<T>(fn: (s: Session) => T): T {
		const s = new Session(structuredClone(this.d), this.clock(), this.tz());
		const out = fn(s);
		this.commit(s);
		return out;
	}

	/** (응답, 재전송 여부). 같은 키의 두 번째 요청은 저장된 첫 응답을 돌려준다. 실패하면 아무것도 바뀌지 않는다. */
	command<T>(key: string, fn: (s: Session) => T): [T, boolean] {
		const hit = this.d.idem[key];
		if (hit) return [hit.response as T, true];
		const s = new Session(structuredClone(this.d), this.clock(), this.tz());
		const out = fn(s);
		s.d.idem[key] = { response: structuredClone(out), at: s.now };
		const keys = Object.entries(s.d.idem)
			.filter(([, v]) => v.at >= s.now - IDEMPOTENCY_TTL)
			.sort((a, b) => b[1].at - a[1].at)
			.slice(0, IDEMPOTENCY_KEEP);
		s.d.idem = Object.fromEntries(keys);
		this.commit(s);
		return [out, false];
	}

	private commit(s: Session): void {
		this.d = s.finish();
		this.store.save(this.d);
	}
}
