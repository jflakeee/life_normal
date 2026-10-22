/** 작업대: 정해 둔 상시 임무를 앱을 닫아도 반복한다 (아이들 형식).
 *  - 지연 평가: 접속할 때 지난 시간만큼 한꺼번에 계산한다
 *  - 오프라인 상한: 마지막 접속 후 8시간까지만 진행한다. 그 뒤 공백은 진행으로 치지 않는다
 *  - 하루 한도: 처음 80건은 정상, 다음 40건은 보상·경험치 50%, 그 뒤로는 쉰다 (새벽 4시 초기화)
 *  진행은 '누적 진행 시간'으로 센다. 그래야 공백을 건너뛰어도 남은 시간이 정확하다. */
import B from '$lib/core/data/balance.json';
import type { Player } from '$lib/core/model';

const I = B.idle;
export const OFFLINE_CAP = I.offline_cap_hours * 3600;
export const DAILY_LIMIT = I.daily_limit;
export const DAILY_FULL = I.daily_full;
export const OVER_RATE = I.over_rate;
export const TAP_SECONDS = I.tap_seconds;
export const TAP_MAX_PER_RUN = I.tap_max_per_run;
export const SLOTS_MAX = I.slots_max;
const DAY_START = I.day_start_hour * 3600;

export interface PendingWork {
	template: string;
	at: number; // 완료 시각
	rate: number; // 1 = 정상, 0.5 = 한도 초과분
}

export interface Slot {
	template: string | null;
	progress: number; // 지금 작업에 쌓인 초 (0 ≤ progress < 한 건 시간)
	lastTick: number; // 마지막으로 계산한 시각
	runs: number; // 이 작업으로 끝낸 건수 (탭 가속을 건마다 세는 데 쓴다)
	tapUsed: number; // 지금 건에 쓴 탭 가속 초
	pending: PendingWork[]; // 끝났지만 아직 받지 않은 작업
}

export interface Workbench {
	slots: Slot[];
	dayCounts: Record<string, number>; // 날짜별 완료 건수 (하루 한도)
}

export const emptySlot = (now: number): Slot => ({ template: null, progress: 0, lastTick: now, runs: 0, tapUsed: 0, pending: [] });

export const newWorkbench = (now: number): Workbench => ({
	slots: Array.from({ length: SLOTS_MAX }, () => emptySlot(now)),
	dayCounts: {}
});

/** 열린 슬롯 수: 처음 1개, 직업이 있으면 2개, 사업이 있으면 3개 */
export const unlockedSlots = (p: Player) =>
	1 + (Object.keys(p.jobs).length > 0 ? 1 : 0) + (p.businesses.length > 0 ? 1 : 0);

/** 새벽 4시를 하루의 시작으로 보는 날짜 키. tzOffsetMin은 Date#getTimezoneOffset() 값 */
export const dayKey = (t: number, tzOffsetMin: number) => String(Math.floor((t - tzOffsetMin * 60 - DAY_START) / 86_400));

export function usedToday(wb: Workbench, now: number, tz: number): number {
	return wb.dayCounts[dayKey(now, tz)] ?? 0;
}

/** 다음 하루 시작(새벽 4시) 시각 */
export function nextDayStart(now: number, tz: number): number {
	const day = Number(dayKey(now, tz)) + 1;
	return day * 86_400 + DAY_START + tz * 60;
}

/** 완료 한 건을 하루 한도에 따라 기록한다. 한도를 넘으면 버린다(쉬는 중) */
function record(wb: Workbench, slot: Slot, at: number, tz: number): boolean {
	const key = dayKey(at, tz);
	const used = wb.dayCounts[key] ?? 0;
	slot.runs++;
	slot.tapUsed = 0;
	if (used >= DAILY_LIMIT) return false;
	wb.dayCounts[key] = used + 1;
	slot.pending.push({ template: slot.template!, at, rate: used < DAILY_FULL ? 1 : OVER_RATE });
	return true;
}

/** 지난 시간만큼 진행시킨다. lastActive = 이번 접속 직전의 마지막 접속 시각 */
export function advance(wb: Workbench, unlocked: number, now: number, lastActive: number, mission: number, tz: number): void {
	const end = Math.min(now, lastActive + OFFLINE_CAP);
	const events: { slot: Slot; at: number }[] = [];
	wb.slots.forEach((slot, i) => {
		if (slot.template && i < unlocked && end > slot.lastTick) {
			let at = slot.lastTick + (mission - slot.progress);
			for (; at <= end; at += mission) events.push({ slot, at });
			slot.progress = mission - (at - end); // 마지막 건에 쌓인 시간
		}
		slot.lastTick = now; // end ~ now 사이 공백은 진행으로 치지 않는다
	});
	events.sort((a, b) => a.at - b.at);
	for (const e of events) record(wb, e.slot, e.at, tz);
	// 오래된 날짜 기록은 정리 (최근 3일만)
	const keys = Object.keys(wb.dayCounts).sort((a, b) => Number(a) - Number(b));
	for (const k of keys.slice(0, -3)) delete wb.dayCounts[k];
}

/** 탭 가속: 지금 건을 10초 당긴다 (건당 최대 30초). 당겨서 끝나면 바로 완료로 기록 */
export function tap(slot: Slot, wb: Workbench, now: number, mission: number, tz: number): 'ok' | 'limit' | 'empty' {
	if (!slot.template) return 'empty';
	if (slot.tapUsed + TAP_SECONDS > TAP_MAX_PER_RUN) return 'limit';
	slot.tapUsed += TAP_SECONDS;
	slot.progress += TAP_SECONDS;
	if (slot.progress >= mission) {
		slot.progress -= mission;
		record(wb, slot, now, tz);
	}
	return 'ok';
}
