/** 브라우저 안 백엔드: 지연 평가 타이머, 대기열, 멱등성, 되돌리기, 수락형 임무, 사업 정산 상한, ledger, 알림, 저장 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api';
import { CHAINS } from '$lib/core/missions';
import { createLocalBackend } from './backend';
import { audit, notifications, SETTLE_INTERVAL, TICK_SECONDS, type SaveData, type Store } from './service';

function memoryStore(): Store & { raw: string | null } {
	return {
		raw: null,
		load() {
			return this.raw ? (JSON.parse(this.raw) as SaveData) : null;
		},
		save(d) {
			this.raw = JSON.stringify(d);
		}
	};
}

function setup(seed = 'test') {
	const clock = { t: 1_000_000 };
	const store = memoryStore();
	let k = 0;
	const be = createLocalBackend({ store, clock: () => clock.t, seed, newKey: () => `k${k++}` });
	const advance = (sec: number) => (clock.t += sec);
	return { be, clock, store, advance };
}

type S = { queue: { ends_at: number; done: boolean }[]; claimable: number; money: number; skills: Record<string, { xp: number; level: number }>; pending_settlements: number; town_tick: number };

describe('local backend', () => {
	it('runs the queue back to back and completes lazily', async () => {
		const { be, clock, advance } = setup();
		const r = await be.command<{ queue_ends_at: number }>('POST', '/queue', { template_id: 'parcel', count: 3 });
		expect(r.queue_ends_at).toBe(clock.t + 3 * TICK_SECONDS);
		advance(2 * TICK_SECONDS);
		const st = await be.get<S>('/state');
		expect(st.claimable).toBe(2);
		expect(st.queue).toHaveLength(3);
		const c = await be.command<{ claimed: unknown[] }>('POST', '/claims');
		expect(c.claimed).toHaveLength(2);
		expect((await be.get<S>('/state')).skills.TRANSPORT.xp).toBe(20);
	});

	it('replays the first response for the same key', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/queue', { template_id: 'parcel', count: 2 });
		advance(10 * TICK_SECONDS);
		const first = be.request('POST', '/claims', undefined, 'same');
		const money = (await be.get<S>('/state')).money;
		const again = be.request('POST', '/claims', undefined, 'same');
		expect(again).toEqual(first);
		expect((await be.get<S>('/state')).money).toBe(money);
	});

	it('rejects a command without a key', () => {
		const { be } = setup();
		expect(() => be.request('POST', '/claims')).toThrowError(ApiError);
	});

	it('leaves state untouched when a command fails', async () => {
		const { be, store } = setup();
		const before = store.raw;
		await expect(be.command('POST', '/shop/buy', { item: '고급 장비' })).rejects.toMatchObject({ status: 409 });
		expect(JSON.parse(store.raw!).player).toEqual(JSON.parse(before!).player);
	});

	it('enforces the queue limit and job rules', async () => {
		const { be } = setup();
		await be.command('POST', '/queue', { template_id: 'parcel', count: 20 });
		await expect(be.command('POST', '/queue', { template_id: 'parcel', count: 1 })).rejects.toMatchObject({ status: 409 });
		await expect(be.command('POST', '/queue', { template_id: 'passenger', count: 1 })).rejects.toMatchObject({ status: 409 });
	});

	it('cancel pulls later runs forward', async () => {
		const { be, clock } = setup();
		const { queued } = await be.command<{ queued: number[] }>('POST', '/queue', { template_id: 'parcel', count: 3 });
		await expect(be.command('DELETE', `/queue/${queued[0]}`)).rejects.toMatchObject({ status: 409 });
		await be.command('DELETE', `/queue/${queued[1]}`);
		const ends = (await be.get<S>('/state')).queue.map((r) => r.ends_at);
		expect(ends).toEqual([clock.t + TICK_SECONDS, clock.t + 2 * TICK_SECONDS]);
	});

	it('keeps the ledger equal to money through risky play', async () => {
		const { be, advance } = setup();
		for (let i = 0; i < 10; i++) {
			await be.command('POST', '/queue', { template_id: 'small_hunt', count: 20 });
			advance(20 * TICK_SECONDS);
			await be.command('POST', '/claims');
		}
		await be.command('POST', '/shop/buy', { item: '기본 장비' });
		expect(audit(be.game.data)).toBe(0);
		expect((await be.get<S>('/state')).skills.HUNTING.level).toBeGreaterThanOrEqual(3);
	});

	it('accepts a chain posting and continues to the next step', async () => {
		const { be, advance } = setup();
		be.game.query((s) => {
			for (const l of ['TRANSPORT', 'HUNTING', 'CONSTRUCTION', 'MEDICAL', 'SECURITY'] as const)
				s.p.jobs[l] = { rank: 'EXPERT', jobMissions: 0, requestsDone: 0 };
			s.p.equipment.push({ name: '중급 장비', price: 1_500, durability: 1 });
			s.board.startChain(CHAINS[0].id);
		});
		type B = { postings: { id: string; chain: string | null }[] };
		const chain = (await be.get<B>('/board')).postings.find((p) => p.chain)!;
		await be.command('POST', `/board/${chain.id}/accept`);
		await expect(be.command('POST', `/board/${chain.id}/accept`)).rejects.toMatchObject({ status: 409 });
		advance(TICK_SECONDS);
		const c = await be.command<{ claimed: { pay?: number }[] }>('POST', '/claims');
		expect(c.claimed[0].pay).toBeGreaterThan(0);
		expect((await be.get<B>('/board')).postings.some((p) => p.chain)).toBe(true);
	});

	it('caps business settlements at one day', async () => {
		const { be, advance } = setup();
		be.game.query((s) => {
			s.p.jobs.HUNTING = { rank: 'CHIEF', jobMissions: 0, requestsDone: 0 };
			s.pay('grant', 50_000, 'test');
		});
		await be.command('POST', '/businesses', { line: 'HUNTING' });
		advance(3 * 86_400);
		expect((await be.get<S>('/state')).pending_settlements).toBe(10);
		expect((await be.command<{ settled: number }>('POST', '/businesses/collect')).settled).toBe(10);
		advance(SETTLE_INTERVAL * 2);
		expect((await be.get<S>('/state')).pending_settlements).toBe(2);
		expect(audit(be.game.data)).toBe(0);
	});

	it('advances the town lazily', async () => {
		const { be, advance } = setup();
		const t0 = (await be.get<S>('/state')).town_tick;
		advance(10 * TICK_SECONDS + 5);
		expect((await be.get<S>('/state')).town_tick).toBe(t0 + 10);
	});

	it('hides event-only templates from the catalog', async () => {
		const { be } = setup();
		const cat = await be.get<{ templates: { id: string }[]; queue_limit: number }>('/catalog');
		const ids = cat.templates.map((t) => t.id);
		expect(ids).toContain('parcel');
		expect(ids).not.toContain('disaster_recovery');
		expect(cat.queue_limit).toBe(20);
	});

	it('notifies finished missions and new events once', async () => {
		const { be, advance } = setup();
		const cursor: Record<string, unknown> = {};
		be.game.query((s) => notifications(s, cursor)); // 구독 시작 시점
		await be.command('POST', '/queue', { template_id: 'parcel', count: 1 });
		advance(TICK_SECONDS);
		be.game.query((s) => s.board.startChain(CHAINS[0].id));
		const out = be.game.query((s) => notifications(s, cursor));
		expect(out.map((e) => e.type)).toEqual(expect.arrayContaining(['mission.done', 'event.started']));
		expect(be.game.query((s) => notifications(s, cursor))).toEqual([]);
	});

	it('subscribe reports online and nothing from before it started', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/queue', { template_id: 'parcel', count: 1 });
		advance(TICK_SECONDS);
		const events: unknown[] = [];
		let online = false;
		const stop = be.subscribe((e) => events.push(e), (o) => (online = o));
		stop();
		expect(online).toBe(true);
		expect(events).toEqual([]);
	});

	it('reopens a saved game and continues deterministically', async () => {
		const a = setup('same');
		await a.be.command('POST', '/queue', { template_id: 'small_hunt', count: 20 });
		a.advance(20 * TICK_SECONDS + 3600);
		await a.be.command('POST', '/claims');
		// 새로고침: 같은 저장소에서 다시 열면 같은 상태
		const reopened = createLocalBackend({ store: a.store, clock: () => a.clock.t });
		expect(reopened.game.data).toEqual(a.be.game.data);
		// 같은 저장 상태에서 같은 행동을 하면 결과도 같다 (난수 상태까지 저장되므로)
		const snapshot = a.store.raw!;
		const fork = () =>
			createLocalBackend({ store: { load: () => JSON.parse(snapshot), save() {} }, clock: () => a.clock.t + 9_000, newKey: () => 'k' });
		const [b, c] = [fork(), fork()];
		for (const be of [b, c]) {
			await be.command('POST', '/queue', { template_id: 'small_hunt', count: 20 });
			await be.get('/board');
		}
		expect(b.game.data).toEqual(c.game.data);
	});
});

describe('save transfer', () => {
	it('exports and imports a save on another device', async () => {
		const a = setup('a');
		await a.be.command('POST', '/queue', { template_id: 'parcel', count: 5 });
		a.advance(5 * TICK_SECONDS);
		await a.be.command('POST', '/claims');
		const file = a.be.saves!.export();
		const b = setup('b');
		b.be.saves!.import(file);
		expect(b.be.game.data).toEqual(a.be.game.data);
		expect(JSON.parse(b.store.raw!)).toEqual(a.be.game.data); // 가져온 세이브가 저장소에도 기록된다
	});

	it('rejects bad files and keeps the current game', async () => {
		const { be, store } = setup();
		await be.command('POST', '/queue', { template_id: 'parcel', count: 1 });
		const before = store.raw;
		const good = JSON.parse(be.saves!.export());
		const tampered = structuredClone(good);
		tampered.data.player.money += 99_999; // ledger와 어긋남
		const old = structuredClone(good);
		old.data.version = 2;
		for (const raw of ['not json', '{"kind":"other"}', JSON.stringify(old), JSON.stringify(tampered)]) {
			expect(() => be.saves!.import(raw)).toThrowError(ApiError);
		}
		expect(store.raw).toBe(before);
	});

	it('resets to a fresh game', async () => {
		const { be } = setup();
		await be.command('POST', '/queue', { template_id: 'parcel', count: 3 });
		be.saves!.reset();
		const st = await be.get<S>('/state');
		expect(st.queue).toHaveLength(0);
		expect(st.money).toBe(100);
	});
});
