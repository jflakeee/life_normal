/** 수집 도감. 첫 획득은 도감 등록(귀속), 중복은 즉시 판매.
 *  보너스: 등록 1개당 해당 계열 경험치 +2%, 계열 완성 시 +10% 추가. */
import B from './data/balance.json';
import C from './data/catalog.json';
import { RARITIES, type Line, type MissionType, type Rarity } from './enums';
import type { Rng } from './rng';

const CB = B.collection;
export const DROP_P: Partial<Record<MissionType, number>> = CB.drop_p;

export interface Collectible {
	id: string;
	name: string;
	line: Line;
	rarity: Rarity;
}

export const CATALOG: Record<string, Collectible> = Object.fromEntries(
	C.entry.map((e) => [e.id, { id: e.id, name: e.name, line: e.line as Line, rarity: e.rarity as Rarity }])
);
const ITEMS = Object.values(CATALOG);
export const COLLECTION_LINES = [...new Set(ITEMS.map((c) => c.line))];

export interface Drop {
	item: Collectible;
	registered: boolean;
	soldFor: number;
}

export function roll(rng: Rng, collectLevel: number, rareFind = false): Collectible {
	const boost = (1 + CB.level_boost_per_lv * (collectLevel - 1)) * (rareFind ? CB.rare_find_boost : 1);
	const count = Object.fromEntries(RARITIES.map((r) => [r, ITEMS.filter((x) => x.rarity === r).length]));
	const weights = ITEMS.map(
		(c) => (CB.rarity_weight[c.rarity] * (c.rarity === 'COMMON' ? 1 : boost)) / count[c.rarity]
	);
	return rng.weighted(ITEMS, weights);
}

/** 플레이어의 도감과 돈을 바꾼다 */
export function obtain(p: { collection: string[]; money: number }, item: Collectible): Drop {
	if (p.collection.includes(item.id)) {
		const price = CB.duplicate_price[item.rarity];
		p.money += price;
		return { item, registered: false, soldFor: price };
	}
	p.collection.push(item.id);
	return { item, registered: true, soldFor: 0 };
}

const lineTotal = (line: Line) => ITEMS.filter((c) => c.line === line).length;

export function xpMult(collection: readonly string[], line: Line): number {
	const total = lineTotal(line);
	if (!total) return 1;
	const owned = ITEMS.filter((c) => c.line === line && collection.includes(c.id)).length;
	return 1 + CB.xp_per_entry * owned + (owned === total ? CB.xp_line_complete : 0);
}

export function progress(collection: readonly string[]) {
	return COLLECTION_LINES.map((line) => ({
		line,
		owned: ITEMS.filter((c) => c.line === line && collection.includes(c.id)).length,
		total: lineTotal(line),
		mult: xpMult(collection, line)
	}));
}
