export const LINES = ['TRANSPORT', 'HUNTING', 'CONSTRUCTION', 'MEDICAL', 'SECURITY', 'COLLECTING'] as const;
export type Line = (typeof LINES)[number];
export const LINE_NAME: Record<Line, string> = {
	TRANSPORT: '운송',
	HUNTING: '사냥',
	CONSTRUCTION: '건축',
	MEDICAL: '치료',
	SECURITY: '보안',
	COLLECTING: '수집'
};

export const TIERS = ['HOBBY', 'JOB', 'BUSINESS'] as const;
export type Tier = (typeof TIERS)[number];

export const RANKS = ['APPRENTICE', 'REGULAR', 'EXPERT', 'CHIEF'] as const;
export type Rank = (typeof RANKS)[number];
export const rankIndex = (r: Rank) => RANKS.indexOf(r);

export const MISSION_TYPES = ['ROUTINE', 'REQUEST', 'EMERGENCY'] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

export const RARITIES = ['COMMON', 'RARE', 'LEGENDARY'] as const;
export type Rarity = (typeof RARITIES)[number];
export const RARITY_NAME: Record<Rarity, string> = { COMMON: '일반', RARE: '희귀', LEGENDARY: '전설' };
