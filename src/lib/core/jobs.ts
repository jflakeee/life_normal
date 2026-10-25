/** 직종: 계열 안에서 고르는 일. 숙련도·명성·건물은 계열에, 직급·특화는 직종에 붙는다. 데이터는 data/jobs.json */
import J from './data/jobs.json';
import { RANKS, rankIndex, type Line, type Rank } from './enums';
import type { Player } from './model';

export interface JobRequirement {
	from: string; // 이 직종에서만 옮겨 올 수 있다
	rank: Rank; // 옮기기 전 직종의 최소 직급
	requests?: number; // 그 계열에서 끝낸 의뢰
	fame?: number; // 그 계열 명성
	processed?: number; // 그 계열에서 끝낸 가공 임무
	fee?: number; // 수련비 같은 고정 비용
}

export interface JobDef {
	id: string;
	name: string;
	line: Line;
	entry: boolean;
	pay_mult: number;
	requires?: JobRequirement;
	bonus?: { templates: string[]; mult: number };
}

export const JOBS: Record<string, JobDef> = Object.fromEntries((J.job as JobDef[]).map((j) => [j.id, j]));
export const TRANSFER = J.transfer;

export const jobsOf = (line: Line) => Object.values(JOBS).filter((j) => j.line === line);
export const entryJob = (line: Line): JobDef | undefined => jobsOf(line).find((j) => j.entry);

/** 직종 급여 배율 (상위 직종 +10~20%) */
export const jobPayMult = (jobId: string | undefined) => (jobId ? (JOBS[jobId]?.pay_mult ?? 1) : 1);

/** 직종 특화 보너스: 그 직종이 잘하는 임무의 보상 배율 */
export function jobRewardMult(p: Player, line: Line, templateId: string): number {
	const b = JOBS[p.jobs[line]?.job ?? '']?.bonus;
	return b && b.templates.includes(templateId) ? b.mult : 1;
}

/** 전직하면 직급이 한 단계 내려간다 (견습 아래로는 안 내려감) */
export const rankAfterTransfer = (rank: Rank): Rank => RANKS[Math.max(0, rankIndex(rank) - 1)];

/** 전직 비용: 수련비 + 내려간 직급의 다음 승급비 절반 */
export function transferFee(p: Player, line: Line, jobId: string, rankFees: Partial<Record<Rank, number>>): number {
	const job = p.jobs[line];
	const target = JOBS[jobId];
	if (!job || !target) return 0;
	const after = rankAfterTransfer(job.rank);
	const next = RANKS[rankIndex(after) + 1] as Rank | undefined;
	const half = next ? Math.round((rankFees[next] ?? 0) * TRANSFER.fee_share) : 0;
	return (target.requires?.fee ?? 0) + half;
}

/** 전직에 부족한 조건 (비어 있으면 전직 가능). 쿨다운은 시간을 아는 쪽(서비스)에서 따로 본다 */
export function transferMissing(p: Player, line: Line, jobId: string, fee: number): string[] {
	const job = p.jobs[line];
	const target = JOBS[jobId];
	if (!job) return ['직업 없음'];
	if (!target || target.line !== line) return ['이 계열의 직종이 아님'];
	if (job.job === jobId) return ['지금 직종'];
	const r = target.requires;
	if (!r) return []; // 진입 직종으로 돌아가는 것은 조건 없음
	const out: string[] = [];
	if (job.job !== r.from) out.push(`${JOBS[r.from]?.name ?? r.from}에서만 전직`);
	if (rankIndex(job.rank) < rankIndex(r.rank)) out.push(`직급 ${r.rank} 이상`);
	if (r.requests && job.requestsDone < r.requests) out.push(`의뢰 완료 ${job.requestsDone}/${r.requests}건`);
	if (r.processed && (job.processDone ?? 0) < r.processed) out.push(`가공 ${job.processDone ?? 0}/${r.processed}건`);
	if (r.fame && (p.fame[line] ?? 0) < r.fame) out.push(`명성 ${p.fame[line] ?? 0}/${r.fame}`);
	if (p.money < fee) out.push(`전직비 ${Math.floor(p.money).toLocaleString('ko-KR')}/${fee.toLocaleString('ko-KR')} G`);
	return out;
}
