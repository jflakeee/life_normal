export interface Template {
	id: string;
	name: string;
	line: string;
	tier: 'HOBBY' | 'JOB' | 'BUSINESS';
	type: 'ROUTINE' | 'REQUEST' | 'EMERGENCY';
	min_rank: string | null;
	gear: number;
	process: { input: string; output: string } | null;
	jobs: string[] | null;
	outlaw?: boolean;
}

export interface Catalog {
	lines: Record<string, string>;
	templates: Template[];
	shop: Record<string, number>;
	repair_rate: number;
	slots_max: number;
	actions: { id: string; task: string; name: string; example: string; spread: [string, number][] }[];
	daily_limit: number;
	mission_seconds: number;
	business: { open_cost: number; revenue: number; tax: number; settlements_per_day: number };
	workers: { max: number; revenue_bonus: number; wage: number; hire_cost: number };
	buildings: { costs: number[]; reward_bonus: number };
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
	fame: Record<string, number>;
	notoriety: { value: number; wanted: boolean; ban_until: number | null };
	actions: Record<string, { name: string; level: number; xp: number; next: number; streak: number; today: number; bonus: number }>;
	job_entry: Record<string, { job: string | null; missing: string[] }>;
	skills: Record<string, { level: number; xp: number }>;
	jobs: Record<
		string,
		{
			rank: string;
			job: string;
			job_name: string | null;
			job_missions: number;
			requests_done: number;
			missing: string[];
			transfers: { job: string; name: string; fee: number; pay_mult: number; missing: string[] }[];
		}
	>;
	equipment: string[];
	businesses: string[];
	workers: number[];
	buildings: Record<string, number>;
	upgrade_costs: Record<string, number | null>;
	pending_settlements: number;
	queue: Run[];
	workbench: WorkbenchState;
	away: { seconds: number; events: string[] };
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

export type Market = Record<string, { name: string; base: number; price: number; from: string | null }>;
export type Collection = Record<string, { owned: number; total: number; xp_mult: number }>;

export interface WorkSlot {
	index: number;
	unlocked: boolean;
	template: string | null;
	name: string | null;
	line: string | null;
	action: boolean;
	pending: number;
	next_in: number | null; // 지금 건이 끝나기까지 남은 초
	tap_left: number;
}

export interface WorkbenchState {
	slots: WorkSlot[];
	used_today: number;
	limit: number;
	full: number;
	over_rate: number;
	resets_at: number;
	offline_cap_hours: number;
}
