/** 공공: 가상의 마을 선거와 정책. 실제 정당·이념은 다루지 않는다.
 *  현실 7일마다 선거. 조건을 갖춘 플레이어와 NPC 2명이 겨루고, 당선자는 7일 임기 동안 정책 하나를 고른다.
 *  NPC가 당선되면 NPC가 고른 정책이 마을에 걸린다. 수치는 balance.json의 election */
import B from './data/balance.json';
import { rankIndex } from './enums';
import { JOBS } from './jobs';
import { actionMissing } from './actions';
import type { Player } from './model';
import type { Rng } from './rng';

export const ELECTION = B.election;
export const POLICIES = ELECTION.policies;
export const POLICY_BY_ID = Object.fromEntries(POLICIES.map((p) => [p.id, p]));
const TERM = ELECTION.term_days * 86_400;

export interface Term {
	until: number;
	winner: 'player' | 'npc';
	name: string;
	policy: string | null; // 플레이어가 당선되면 고를 때까지 null
}
export interface ElectionResult {
	at: number;
	player: number | null; // 출마하지 못했으면 null
	npcs: [string, number][];
	winner: string;
}
export interface ElectionState {
	next: number;
	term: Term | null;
	last: ElectionResult | null;
}

export const newElection = (now: number): ElectionState => ({ next: now + TERM, term: null, last: null });

/** 출마에 부족한 조건: 공무원(또는 현직 정치인) 전문 이상 + 정치인 행동 조건 */
export function candidacyMissing(p: Player): string[] {
	const job = p.jobs.CIVIC;
	if (!job) return ['공무원이어야 함'];
	const out: string[] = [];
	if (job.job !== 'civil_servant' && job.job !== 'politician') out.push('공무원이어야 함');
	if (rankIndex(job.rank) < rankIndex('EXPERT')) out.push('공무원 전문 이상');
	return out.concat(actionMissing(p, JOBS.politician.actions));
}

/** 플레이어 득표: 공공 명성 + 마을 기여(끝낸 의뢰 5건당 1, 최대 40) + 운(0~20) */
export function playerScore(p: Player, rng: Rng): number {
	const requests = Object.values(p.jobs).reduce((n, j) => n + (j?.requestsDone ?? 0), 0);
	const contribution = Math.min(ELECTION.contribution_cap, requests / ELECTION.contribution_per);
	return (p.fame.CIVIC ?? 0) + contribution + rng.next() * ELECTION.luck;
}

/** 선거 한 번: 결과를 돌려주고 직종·임기를 바꾼다 (정책 적용은 부르는 쪽에서) */
export function holdElection(p: Player, e: ElectionState, rng: Rng, at: number): ElectionResult {
	const [lo, hi] = ELECTION.npc_score;
	const names = [...ELECTION.npc_names].sort(() => rng.next() - 0.5).slice(0, 2);
	const npcs: [string, number][] = names.map((n) => [n, Math.round(lo + rng.next() * (hi - lo))]);
	const eligible = candidacyMissing(p).length === 0;
	const mine = eligible ? Math.round(playerScore(p, rng)) : null;
	const best = npcs.reduce((a, b) => (b[1] > a[1] ? b : a));
	const won = mine !== null && mine > best[1];
	const job = p.jobs.CIVIC;
	if (won) {
		job!.job = 'politician';
		e.term = { until: at + TERM, winner: 'player', name: '나', policy: null };
	} else {
		if (job?.job === 'politician') job.job = 'civil_servant'; // 낙선하면 공무원으로
		e.term = { until: at + TERM, winner: 'npc', name: best[0], policy: POLICIES[Math.floor(rng.next() * POLICIES.length)].id };
	}
	e.last = { at, player: mine, npcs, winner: won ? '나' : best[0] };
	return e.last;
}

// ── 정책 효과 ──────────────────────────────────────────
export const policyXpMult = (policy: string | null | undefined) => (policy === 'scholarship' ? 1.05 : 1);
export const policyBizTax = (policy: string | null | undefined, base: number) => (policy === 'commerce_boost' ? base - 0.03 : base);
/** 정책의 대가: 정치인 급여 (축제 지원 −20%, 장학금 0) */
export const politicianPayMult = (policy: string | null | undefined) =>
	policy === 'festival_support' ? 0.8 : policy === 'scholarship' ? 0 : 1;
