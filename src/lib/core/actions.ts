/** 일상 행동: 계열에 묶이지 않는 기본 동작. 행동 숙련이 오르고, 경험이 여러 계열 취미로 나뉘어 들어간다.
 *  직종 진입·전직 조건으로 쓴다 (취미 임무는 막지 않음). 데이터는 data/actions.json */
import A from './data/actions.json';
import { LINES, type Line } from './enums';
import type { Player } from './model';

export interface ActionDef {
	id: string;
	name: string;
	example: string;
	spread: Record<string, number>; // 계열 → 비율 (아직 없는 계열은 있는 계열끼리 비율을 다시 맞춘다)
}
export interface ActionState {
	level: number;
	xp: number;
}
/** 습관 기록: 그날 한 건수, 하루 10건을 채운 마지막 날, 연속 일수 */
export interface HabitState {
	day: string;
	count: number;
	lastQualified: string | null;
	streak: number;
}

export const ACTIONS: Record<string, ActionDef> = Object.fromEntries((A.action as unknown as ActionDef[]).map((a) => [a.id, a]));
export const ACTION_RULES = A.rules;
export const ACTION_PREFIX = 'act.';
export const isActionTask = (task: string) => task.startsWith(ACTION_PREFIX);
export const actionIdOf = (task: string) => task.slice(ACTION_PREFIX.length);

export const actionXpToNext = (level: number) => Math.round(ACTION_RULES.xp_base * level ** ACTION_RULES.xp_exponent);

export function actionLevel(p: Player, id: string): number {
	return p.actions?.[id]?.level ?? 1;
}

export function addActionXp(p: Player, id: string, amount: number): number {
	p.actions ??= {};
	const s = (p.actions[id] ??= { level: 1, xp: 0 });
	let gained = 0;
	s.xp += amount;
	while (s.level < ACTION_RULES.max_level && s.xp >= actionXpToNext(s.level)) {
		s.xp -= actionXpToNext(s.level);
		s.level++;
		gained++;
	}
	if (s.level === ACTION_RULES.max_level) s.xp = 0;
	return gained;
}

/** 지금 게임에 있는 계열만으로 비율을 다시 맞춘 배분 */
export function activeSpread(id: string): [Line, number][] {
	const entries = Object.entries(ACTIONS[id].spread).filter(([l]) => (LINES as readonly string[]).includes(l)) as [Line, number][];
	const total = entries.reduce((s, [, w]) => s + w, 0);
	return entries.map(([l, w]) => [l, w / total]);
}

/** 부족한 행동 조건 (비어 있으면 충족) */
export function actionMissing(p: Player, req: Record<string, number> | undefined): string[] {
	if (!req) return [];
	return Object.entries(req)
		.filter(([id, lv]) => actionLevel(p, id) < lv)
		.map(([id, lv]) => `${ACTIONS[id]?.name ?? id} ${actionLevel(p, id)}/${lv}`);
}

/** 부족한 행동 id 목록 */
export function missingActionIds(p: Player, req: Record<string, number> | undefined): string[] {
	return req ? Object.entries(req).filter(([id, lv]) => actionLevel(p, id) < lv).map(([id]) => id) : [];
}

/** 습관 배율: 지금 이어지는 연속 일수 상위 3개만 효과 (3일 +10%, 7일 +20%) */
export function habitStreak(p: Player, id: string, today: string): number {
	const h = p.habits?.[id];
	if (!h || !h.lastQualified) return 0;
	const gap = Number(today) - Number(h.lastQualified);
	return gap >= 0 && gap <= 1 ? h.streak : 0; // 하루 넘게 비었거나 (기기 시계가 바뀌어) 미래 날짜면 연속이 아님
}

export function habitMult(p: Player, id: string, today: string): number {
	const streaks = Object.keys(ACTIONS)
		.map((a) => [a, habitStreak(p, a, today)] as const)
		.filter(([, s]) => s > 0)
		.sort((a, b) => b[1] - a[1])
		.slice(0, ACTION_RULES.habit.max_active);
	const mine = streaks.find(([a]) => a === id)?.[1] ?? 0;
	let bonus = 0;
	for (const [days, b] of ACTION_RULES.habit.tiers) if (mine >= days) bonus = b;
	return 1 + bonus;
}

/** 오늘 이 행동을 한 건 더 했다고 기록 (하루 10건을 채우는 순간 연속 일수가 이어진다) */
export function recordHabit(p: Player, id: string, today: string): void {
	p.habits ??= {};
	const h = (p.habits[id] ??= { day: today, count: 0, lastQualified: null, streak: 0 });
	if (h.day !== today) {
		h.day = today;
		h.count = 0;
	}
	h.count++;
	if (h.count === ACTION_RULES.habit.daily_count) {
		const continued = h.lastQualified !== null && Number(today) - Number(h.lastQualified) === 1;
		h.streak = continued ? h.streak + 1 : 1;
		h.lastQualified = today;
	}
}
