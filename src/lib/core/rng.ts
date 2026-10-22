/** 시드 고정 난수 (sfc32). 상태를 저장·복원할 수 있어 세이브 후에도 같은 결과가 이어진다. */
export type RngState = [number, number, number, number];

function hashSeed(seed: string): RngState {
	// cyrb128: 문자열 → 128비트 시드
	let h1 = 1779033703,
		h2 = 3144134277,
		h3 = 1013904242,
		h4 = 2773480762;
	for (let i = 0; i < seed.length; i++) {
		const k = seed.charCodeAt(i);
		h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
		h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
		h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
		h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
	}
	h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
	h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
	h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
	h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
	return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export class Rng {
	private s: RngState;

	constructor(seed: string | number | RngState) {
		this.s = Array.isArray(seed) ? [...seed] : hashSeed(String(seed));
		for (let i = 0; i < 12; i++) this.next(); // 초기 상태 섞기
	}

	static restore(state: RngState): Rng {
		const r = Object.create(Rng.prototype) as Rng;
		r.s = [...state];
		return r;
	}

	get state(): RngState {
		return [...this.s];
	}

	/** [0, 1) */
	next(): number {
		let [a, b, c, d] = this.s;
		a >>>= 0;
		b >>>= 0;
		c >>>= 0;
		d >>>= 0;
		const t = (((a + b) | 0) + d) | 0;
		d = (d + 1) | 0;
		a = b ^ (b >>> 9);
		b = (c + (c << 3)) | 0;
		c = (c << 21) | (c >>> 11);
		c = (c + t) | 0;
		this.s = [a, b, c, d];
		return (t >>> 0) / 4294967296;
	}

	uniform(lo: number, hi: number): number {
		return lo + (hi - lo) * this.next();
	}

	/** [lo, hi] 정수 */
	int(lo: number, hi: number): number {
		return lo + Math.floor(this.next() * (hi - lo + 1));
	}

	choice<T>(items: readonly T[]): T {
		return items[Math.floor(this.next() * items.length)];
	}

	weighted<T>(items: readonly T[], weights: readonly number[]): T {
		const total = weights.reduce((s, w) => s + w, 0);
		let x = this.next() * total;
		for (let i = 0; i < items.length; i++) {
			x -= weights[i];
			if (x < 0) return items[i];
		}
		return items[items.length - 1];
	}
}
