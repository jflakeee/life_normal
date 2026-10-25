/** 무법 경로(해적): 보상이 높은 대신 악명이 쌓이고, 수배 중이면 습격할 때마다 체포될 수 있다.
 *  악명은 하루 20씩 저절로 줄어든다. 수배 중(악명 30 이상)이면 하루에 한 번 형사가 추적한다 (확률 = 악명 × 0.25%).
 *  체포: 벌금(소지금 15%, 상한 있음), 악명 −50, 24시간 해적 일 금지.
 *  하루 한 번만 판정하는 까닭: 작업대로 하루 120건을 습격해도 체포 횟수가 습격 횟수에 끌려가지 않게 수치는 balance.json의 outlaw */
import B from './data/balance.json';
import type { Player } from './model';

export const OUTLAW = { ...B.outlaw };

export interface Notoriety {
	value: number; // 0~100
	at: number; // 마지막으로 하루 감소를 계산한 시각
	banUntil?: number; // 체포된 뒤 해적 일을 못 하는 시각
	checkedDay?: string; // 형사가 마지막으로 추적한 날
}

export const notoriety = (p: Player) => p.notoriety?.value ?? 0;
export const isWanted = (p: Player) => notoriety(p) >= OUTLAW.wanted_at;
export const isBanned = (p: Player, now: number) => (p.notoriety?.banUntil ?? 0) > now;

/** 지난 날수만큼 악명을 줄인다 (지연 평가) */
export function decayNotoriety(p: Player, now: number): void {
	const n = p.notoriety;
	if (!n) return;
	const days = Math.floor((now - n.at) / 86_400);
	if (days <= 0) return;
	n.value = Math.max(0, n.value - OUTLAW.decay_per_day * days);
	n.at += days * 86_400;
}

export function addNotoriety(p: Player, amount: number, now: number): void {
	p.notoriety ??= { value: 0, at: now };
	p.notoriety.value = Math.max(0, Math.min(100, p.notoriety.value + amount));
}

/** 오늘 형사가 추적하는 확률: 수배 중일 때만, 악명 × 0.25%. 하루에 한 번만 (이미 오늘 판정했으면 0) */
export function arrestChance(p: Player, day: string): number {
	if (!isWanted(p) || p.notoriety?.checkedDay === day) return 0;
	return notoriety(p) * OUTLAW.arrest_daily_per_point;
}

/** 오늘 추적했다고 기록 */
export function markChecked(p: Player, day: string): void {
	if (p.notoriety && isWanted(p)) p.notoriety.checkedDay = day;
}

/** 체포: 벌금을 매기고(반환), 악명을 줄이고, 해적 일을 막는다 */
export function arrest(p: Player, now: number): number {
	const fine = Math.min(OUTLAW.fine_cap, Math.max(0, p.money) * OUTLAW.fine_rate);
	p.money -= fine;
	addNotoriety(p, OUTLAW.after_arrest, now);
	p.notoriety!.banUntil = now + OUTLAW.ban_hours * 3600;
	return fine;
}
