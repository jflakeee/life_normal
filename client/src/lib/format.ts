export function gold(n: number): string {
	return `${Math.round(n).toLocaleString('ko-KR')} G`;
}

/** 남은 초 → "2:41" */
export function clock(seconds: number): string {
	const s = Math.max(0, Math.ceil(seconds));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 다음 레벨까지 필요한 경험치 (core.model.xp_to_next와 같은 식) */
export function xpToNext(level: number, base = 100, exponent = 1.5): number {
	return Math.round(base * level ** exponent);
}

export const RANK_NAME: Record<string, string> = {
	APPRENTICE: '견습',
	REGULAR: '정규',
	EXPERT: '전문',
	CHIEF: '책임'
};

export const TYPE_NAME: Record<string, string> = { ROUTINE: '상시', REQUEST: '의뢰', EMERGENCY: '돌발' };
