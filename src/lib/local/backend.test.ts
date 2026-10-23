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
	const be = createLocalBackend({ store, clock: () => clock.t, seed, newKey: () => `k${k++}`, tz: () => 0 });
	const advance = (sec: number) => (clock.t += sec);
	return { be, clock, store, advance };
}

type W = { slots: { template: string | null; pending: number; next_in: number | null; unlocked: boolean }[]; used_today: number };
type S = { workbench: W; queue: { ends_at: number; done: boolean }[]; claimable: number; money: number; skills: Record<string, { xp: number; level: number }>; pending_settlements: number; town_tick: number };

describe('local backend', () => {
	it('the workbench repeats a task and completes lazily', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		advance(2 * TICK_SECONDS + 5);
		const st = await be.get<S>('/state');
		expect(st.claimable).toBe(2);
		expect(st.workbench.slots[0].pending).toBe(2);
		expect(st.workbench.slots[0].next_in).toBe(TICK_SECONDS - 5);
		const c = await be.command<{ claimed: unknown[] }>('POST', '/claims');
		expect(c.claimed).toHaveLength(2);
		expect((await be.get<S>('/state')).skills.TRANSPORT.xp).toBe(20);
	});

	it('replays the first response for the same key', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
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

	it('enforces slot and job rules', async () => {
		const { be } = setup();
		await expect(be.command('POST', '/workbench/1', { template_id: 'parcel' })).rejects.toMatchObject({ status: 409 }); // 잠긴 슬롯
		await expect(be.command('POST', '/workbench/0', { template_id: 'passenger' })).rejects.toMatchObject({ status: 409 }); // 직업 없음
		await expect(be.command('POST', '/workbench/0', { template_id: 'pest_control' })).rejects.toMatchObject({ status: 409 }); // 상시 아님
	});

	it('tap speeds up the current task by 10s, at most 30s per task', async () => {
		const { be } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		for (let i = 0; i < 3; i++) await be.command('POST', '/workbench/0/tap');
		expect((await be.get<S>('/state')).workbench.slots[0].next_in).toBe(TICK_SECONDS - 30);
		await expect(be.command('POST', '/workbench/0/tap')).rejects.toMatchObject({ status: 409 });
	});

	it('stopping keeps finished work claimable', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		advance(TICK_SECONDS);
		await be.command('DELETE', '/workbench/0');
		advance(5 * TICK_SECONDS);
		const st = await be.get<S>('/state');
		expect(st.workbench.slots[0].template).toBeNull();
		expect(st.claimable).toBe(1);
	});

	it('keeps the ledger equal to money through risky play', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'small_hunt' });
		for (let i = 0; i < 10; i++) {
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
		const cat = await be.get<{ templates: { id: string }[]; slots_max: number }>('/catalog');
		const ids = cat.templates.map((t) => t.id);
		expect(ids).toContain('parcel');
		expect(ids).not.toContain('disaster_recovery');
		expect(cat.slots_max).toBe(3);
	});

	it('notifies finished missions and new events once', async () => {
		const { be, advance } = setup();
		const cursor: Record<string, unknown> = {};
		be.game.query((s) => notifications(s, cursor)); // 구독 시작 시점
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		advance(TICK_SECONDS);
		be.game.query((s) => s.board.startChain(CHAINS[0].id));
		const out = be.game.query((s) => notifications(s, cursor));
		expect(out.map((e) => e.type)).toEqual(expect.arrayContaining(['mission.done', 'event.started']));
		expect(be.game.query((s) => notifications(s, cursor))).toEqual([]);
	});

	it('subscribe reports online and nothing from before it started', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
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
		await a.be.command('POST', '/workbench/0', { template_id: 'small_hunt' });
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
			await be.command('POST', '/workbench/0', { template_id: 'small_hunt' });
			await be.get('/board');
		}
		expect(b.game.data).toEqual(c.game.data);
	});
});

describe('save transfer', () => {
	it('exports and imports a save on another device', async () => {
		const a = setup('a');
		await a.be.command('POST', '/workbench/0', { template_id: 'parcel' });
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
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
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
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		be.saves!.reset();
		const st = await be.get<S>('/state');
		expect(st.workbench.slots[0].template).toBeNull();
		expect(st.money).toBe(100);
	});
});

describe('processing missions', () => {
	it('needs the job, then pays margin plus wage', async () => {
		const { be, advance } = setup();
		await expect(be.command('POST', '/workbench/0', { template_id: 'process_lumber' })).rejects.toMatchObject({ status: 409 });
		be.game.query((s) => {
			s.p.jobs.CONSTRUCTION = { rank: 'APPRENTICE', jobMissions: 0, requestsDone: 0 };
		});
		await be.command('POST', '/workbench/0', { template_id: 'process_lumber' });
		advance(2 * TICK_SECONDS);
		const c = await be.command<{ claimed: { reward: number; pay: number }[] }>('POST', '/claims');
		expect(c.claimed.map((x) => x.reward)).toEqual([3, 3]);
		expect(c.claimed[0].pay).toBeGreaterThan(0);
		expect(audit(be.game.data)).toBe(0);
	});

	it('old saves without processed items keep working', async () => {
		const { be, store } = setup();
		const d = JSON.parse(store.raw!);
		for (const k of ['lumber', 'medicine', 'cut_meat', 'leather_goods']) delete d.town.world.market[k];
		const reopened = createLocalBackend({ store: { load: () => d, save() {} }, clock: () => 1_000_000 });
		const m = await reopened.get<Record<string, unknown>>('/market');
		expect(Object.keys(m)).toContain('leather_goods');
		expect(be).toBeDefined();
	});
});

describe('workbench (idle)', () => {
	// 시작 시각 1,000,000초 = UTC 13:46. 하루는 새벽 4시(UTC, tz 0)에 바뀐다
	it('keeps working offline for at most 8 hours, then pauses until the next visit', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		advance(9 * 3600); // 9시간 자리 비움 → 8시간(160건)까지만 진행, 하루 한도 120건
		const st = await be.get<S>('/state');
		expect(st.workbench.slots[0].pending).toBe(120);
		expect(st.workbench.used_today).toBe(120);
		// 8시간 시점에서 멈췄다가, 지금 접속부터 다시 흐른다 (공백 1시간은 진행으로 치지 않음)
		expect(st.workbench.slots[0].next_in).toBe(TICK_SECONDS);
	});

	it('pays full for 80, half for the next 40, then rests', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		advance(8 * 3600);
		const c = await be.command<{ claimed: { rate: number }[] }>('POST', '/claims');
		const rates = c.claimed.map((x) => x.rate);
		expect(rates.filter((r) => r === 1)).toHaveLength(80);
		expect(rates.filter((r) => r === 0.5)).toHaveLength(40);
		advance(TICK_SECONDS * 5); // 쉬는 중: 더 쌓이지 않는다
		expect((await be.get<S>('/state')).claimable).toBe(0);
		expect(audit(be.game.data)).toBe(0);
	});

	it('starts a fresh daily limit at 4am', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		advance(8 * 3600); // 21:46, 한도 도달
		await be.command('POST', '/claims');
		advance(8 * 3600); // 다음 날 05:46: 04:00 이후 106분만 새로 센다
		const st = await be.get<S>('/state');
		expect(st.workbench.used_today).toBe(Math.floor((106 * 60 - 0) / TICK_SECONDS) + 1);
		expect(st.workbench.used_today).toBeLessThan(40);
	});

	it('opens a second slot with a job and a third with a business', async () => {
		const { be } = setup();
		const open = async () => (await be.get<S>('/state')).workbench.slots.filter((x) => x.unlocked).length;
		expect(await open()).toBe(1);
		be.game.query((s) => {
			s.p.jobs.HUNTING = { rank: 'CHIEF', jobMissions: 0, requestsDone: 0 };
		});
		expect(await open()).toBe(2);
		be.game.query((s) => s.pay('grant', 50_000, 'test'));
		await be.command('POST', '/businesses', { line: 'HUNTING' });
		expect(await open()).toBe(3);
	});

	it('slots share one daily limit', async () => {
		const { be, advance } = setup();
		be.game.query((s) => {
			s.p.jobs.TRANSPORT = { rank: 'APPRENTICE', jobMissions: 0, requestsDone: 0 };
		});
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		await be.command('POST', '/workbench/1', { template_id: 'passenger' });
		advance(8 * 3600);
		const st = await be.get<S>('/state');
		expect(st.workbench.slots[0].pending + st.workbench.slots[1].pending).toBe(120);
	});

	it('a v3 save keeps its queued missions and gets a workbench', async () => {
		const { be, store, clock } = setup();
		const d = JSON.parse(store.raw!);
		d.version = 3;
		delete d.workbench;
		delete d.lastActive;
		d.runs = [{ id: 1, template: 'parcel', source: 'queue', postingId: null, reward: 5, startedAt: clock.t - 400, endsAt: clock.t - 200 }];
		const old = createLocalBackend({ store: { load: () => d, save() {} }, clock: () => clock.t, tz: () => 0 });
		const st = await old.get<S>('/state');
		expect(st.workbench.slots).toHaveLength(3);
		const c = await old.command<{ claimed: { reward: number }[] }>('POST', '/claims');
		expect(c.claimed[0].reward).toBe(5);
		expect(be).toBeDefined();
	});
});

describe('fame migration', () => {
	it('a v4 save turns per-line request counts into fame', async () => {
		const { store, clock } = setup();
		const d = JSON.parse(store.raw!);
		d.version = 4;
		d.player.reputation = 42;
		delete d.player.fame;
		d.player.jobs.HUNTING = { rank: 'EXPERT', jobMissions: 100, requestsDone: 30 };
		const old = createLocalBackend({ store: { load: () => d, save() {} }, clock: () => clock.t, tz: () => 0 });
		const st = await old.get<{ fame: Record<string, number> }>('/state');
		expect(st.fame.HUNTING).toBe(30);
		expect(st.fame.TRANSPORT).toBe(0);
		expect(old.game.data.version).toBe(6); // v4 → v5(명성) → v6(일꾼·건물)
		expect('reputation' in old.game.data.player).toBe(false);
	});
});

describe('workers and buildings (long-run sinks)', () => {
	const rich = (be: ReturnType<typeof setup>['be']) =>
		be.game.query((s) => {
			s.p.jobs.HUNTING = { rank: 'CHIEF', jobMissions: 0, requestsDone: 0 };
			s.pay('grant', 200_000, 'test');
		});

	it('a worker costs 3,000 G, raises settlement revenue and is paid every settlement', async () => {
		const a = setup('w');
		const b = setup('w');
		for (const x of [a, b]) {
			rich(x.be);
			await x.be.command('POST', '/businesses', { line: 'HUNTING' });
		}
		const before = a.be.game.data.player.money;
		await a.be.command('POST', '/businesses/0/hire');
		expect(before - a.be.game.data.player.money).toBe(3_000);
		for (const x of [a, b]) x.advance(86_400);
		const ra = await a.be.command<{ net: number }>('POST', '/businesses/collect');
		const rb = await b.be.command<{ net: number }>('POST', '/businesses/collect');
		expect(ra.net).toBeGreaterThan(rb.net); // 같은 시드: 일꾼이 있는 쪽이 더 번다
		expect(a.be.game.data.ledger.totals.worker_wage).toBeCloseTo(-30 * 10);
		expect(audit(a.be.game.data)).toBe(0);
	});

	it('allows at most 3 workers per business', async () => {
		const { be } = setup();
		rich(be);
		await be.command('POST', '/businesses', { line: 'HUNTING' });
		for (let i = 0; i < 3; i++) await be.command('POST', '/businesses/0/hire');
		await expect(be.command('POST', '/businesses/0/hire')).rejects.toMatchObject({ status: 409 });
		await expect(be.command('POST', '/businesses/5/hire')).rejects.toMatchObject({ status: 409 });
	});

	it('building upgrades cost 20k then 50k and raise that line’s rewards by 5% each', async () => {
		const { be, advance } = setup();
		rich(be);
		await be.command('POST', '/buildings/TRANSPORT/upgrade');
		await be.command('POST', '/buildings/TRANSPORT/upgrade');
		await expect(be.command('POST', '/buildings/TRANSPORT/upgrade')).rejects.toMatchObject({ status: 409 });
		expect(be.game.data.ledger.totals.building_upgrade).toBe(-70_000);
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		advance(TICK_SECONDS);
		const c = await be.command<{ claimed: { reward: number }[] }>('POST', '/claims');
		expect(c.claimed[0].reward).toBe(Math.round(5 * 1.1)); // 소포 배달 5 G × 1.1
		expect(audit(be.game.data)).toBe(0);
	});

	it('a v5 save gets empty worker and building records', async () => {
		const { store, clock } = setup();
		const d = JSON.parse(store.raw!);
		d.version = 5;
		delete d.player.workers;
		delete d.player.buildings;
		const old = createLocalBackend({ store: { load: () => d, save() {} }, clock: () => clock.t, tz: () => 0 });
		const st = await old.get<{ buildings: Record<string, number>; workers: number[] }>('/state');
		expect(st.workers).toEqual([]);
		expect(st.buildings.HUNTING).toBe(0);
	});
});

describe('coming back (away report)', () => {
	it('reports how long you were away and what happened in town', async () => {
		const { be, advance } = setup();
		await be.command('POST', '/workbench/0', { template_id: 'parcel' });
		be.game.query((s) => s.board.startChain('storm')); // 자리 비우기 전에 생긴 일은 소식에 들지 않는다
		advance(3 * 3600);
		const st = await be.get<{ away: { seconds: number; events: string[] }; claimable: number }>('/state');
		expect(st.away.seconds).toBe(3 * 3600);
		expect(st.claimable).toBe(60);
		expect(st.away.events.every((e) => !e.startsWith('['))).toBe(true); // 틱 표기 없이 읽기 좋은 문장
		const again = await be.get<{ away: { seconds: number } }>('/state');
		expect(again.away.seconds).toBe(0); // 다시 보면 방금 접속한 것
	});
});
