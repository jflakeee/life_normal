/** 연구 (과학자): 실험이 연구 점수를 쌓고, 점수와 돈으로 기술을 해금한다. 효과는 작고 영구적이며
 *  하루 한도(120건)는 건드리지 않는다. 기술 목록은 balance.json의 research */
import B from './data/balance.json';
import type { Line } from './enums';
import type { MissionTemplate } from './missions';
import type { Player } from './model';

export interface TechDef {
	id: string;
	name: string;
	points: number;
	cost: number;
	effect: string;
}
export interface ResearchState {
	points: number;
	techs: string[];
}

export const TECHS: TechDef[] = B.research.techs;
export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));

export const hasTech = (p: Player, id: string) => p.research?.techs.includes(id) ?? false;
export const researchPoints = (p: Player) => p.research?.points ?? 0;

export function addResearch(p: Player, n: number): void {
	p.research ??= { points: 0, techs: [] };
	p.research.points += n;
}

export function techMissing(p: Player, id: string): string[] {
	const t = TECH_BY_ID[id];
	if (!t) return ['없는 기술'];
	if (hasTech(p, id)) return ['이미 해금'];
	const out: string[] = [];
	if (researchPoints(p) < t.points) out.push(`연구 점수 ${researchPoints(p)}/${t.points}`);
	if (p.money < t.cost) out.push(`연구비 ${Math.floor(p.money).toLocaleString('ko-KR')}/${t.cost.toLocaleString('ko-KR')} G`);
	return out;
}

/** 해금: 연구 점수와 연구비를 쓴다 */
export function unlockTech(p: Player, id: string): void {
	const missing = techMissing(p, id);
	if (missing.length) throw new Error('해금 조건 부족: ' + missing.join(', '));
	const t = TECH_BY_ID[id];
	p.research!.points -= t.points;
	p.money -= t.cost;
	p.research!.techs.push(id);
}

// ── 기술 효과 ──────────────────────────────────────────
/** 임무 보상 배율: 정밀 도구(가공 +5%), 비료 개량(농업 수확 +5%) */
export function techRewardMult(p: Player, t: Pick<MissionTemplate, 'process' | 'yieldItem' | 'line'>): number {
	let m = 1;
	if (t.process && hasTech(p, 'precision_tools')) m *= 1.05;
	if (t.yieldItem && t.line === ('AGRICULTURE' as Line) && hasTech(p, 'fertilizer')) m *= 1.05;
	return m;
}
export const techDropMult = (p: Player) => (hasTech(p, 'field_guide') ? 1.1 : 1);
export const techInjuryMult = (p: Player) => (hasTech(p, 'safety_gear') ? 0.8 : 1);
export const techTapMax = (p: Player, base: number) => (hasTech(p, 'efficient_bench') ? 40 : base);
