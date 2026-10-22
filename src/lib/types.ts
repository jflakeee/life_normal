export interface Template {
	id: string;
	name: string;
	line: string;
	tier: 'HOBBY' | 'JOB' | 'BUSINESS';
	type: 'ROUTINE' | 'REQUEST' | 'EMERGENCY';
	min_rank: string | null;
	gear: number;
}

export interface Catalog {
	lines: Record<string, string>;
	templates: Template[];
	shop: Record<string, number>;
	repair_rate: number;
	queue_limit: number;
	mission_seconds: number;
	business: { open_cost: number; revenue: number; tax: number; settlements_per_day: number };
}

export interface Run {
	id: number;
	template: string;
	name: string;
	source: 'queue' | 'board';
	reward: number;
	ends_at: number;
	done: boolean;
}

export interface PlayerState {
	now: number;
	money: number;
	reputation: number;
	skills: Record<string, { level: number; xp: number }>;
	jobs: Record<string, { rank: string; job_missions: number; requests_done: number; missing: string[] }>;
	equipment: string[];
	businesses: string[];
	pending_settlements: number;
	queue: Run[];
	claimable: number;
	town_tick: number;
}

export interface Posting {
	id: string;
	name: string;
	line: string;
	type: string;
	reward: number;
	deadline_ticks: number;
	chain: string | null;
	available: boolean;
	accepted: boolean;
}

export interface Board {
	postings: Posting[];
	events: string[];
}

export type Market = Record<string, { name: string; base: number; price: number }>;
export type Collection = Record<string, { owned: number; total: number; xp_mult: number }>;
