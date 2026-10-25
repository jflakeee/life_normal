/** 화면 상태: 백엔드가 진실이고, 여기는 마지막으로 받은 스냅숏과 표시용 시계만 가진다. */
import { ApiError, type Backend, type ServerEvent } from './api';
import type { Board, Catalog, Collection, Market, PlayerState, Template } from './types';

type GameEvent = ServerEvent &
	(
	| { type: 'mission.done'; count: number; resting: boolean }
	| { type: 'event.started' | 'event.step'; text: string }
	| { type: 'market.changed' }
	| { type: 'settlement.ready' });

export interface AwayReport {
	seconds: number;
	pending: number;
	events: string[];
	result?: { gained: number; levels: string[]; drops: string[] };
}

const AWAY_MIN_SECONDS = 30 * 60;

/** 걸작·경기 승리 같은 눈에 띄는 결과를 "걸작 2점, 승리 1번"으로 */
function highlights(outcomes: (string | null | undefined)[]): string {
	const n = (label: string) => outcomes.filter((o) => o === label).length;
	return [n('걸작') && `걸작 ${n('걸작')}점`, n('승리') && `경기 승리 ${n('승리')}번`].filter(Boolean).join(', ');
}

export class Game {
	catalog = $state<Catalog | null>(null);
	player = $state<PlayerState | null>(null);
	board = $state<Board>({ postings: [], events: [] });
	market = $state<Market>({});
	collection = $state<Collection>({});
	toast = $state<string | null>(null);
	busy = $state(false);
	online = $state(true);
	/** 돌아왔을 때 요약 (30분 넘게 비웠고 받을 것이나 소식이 있을 때) */
	away = $state<AwayReport | null>(null);
	/** 서버 시각 기준 현재 (1초마다 갱신) */
	now = $state(0);

	private offset = 0; // 서버 시각 - 기기 시각
	private toastTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private api: Backend) {}

	async start(): Promise<void> {
		await this.api.login();
		this.catalog = await this.api.get<Catalog>('/catalog');
		await this.refresh();
		const a = this.player!.away;
		if (a.seconds >= AWAY_MIN_SECONDS && (this.claimable > 0 || a.events.length))
			this.away = { seconds: a.seconds, pending: this.claimable, events: a.events };
		setInterval(() => (this.now = Date.now() / 1000 + this.offset), 1000);
		// 알림 연결이 끊겨 있는 동안에는 30초마다 직접 상태를 받는다
		setInterval(() => {
			if (!this.online && document.visibilityState === 'visible') void this.refresh().catch(() => {});
		}, 30_000);
		this.api.subscribe(
			(e) => this.onEvent(e as GameEvent),
			(online) => {
				this.online = online;
				if (online) void this.refresh().catch(() => {}); // 끊긴 사이에 놓친 것을 스냅숏으로 복구
			}
		);
		document.addEventListener('visibilitychange', () => {
			// 앱으로 돌아오면 스냅숏부터 받는다
			if (document.visibilityState === 'visible') void this.refresh().catch(() => {});
		});
	}

	async refresh(): Promise<void> {
		const [player, board, market, collection] = await Promise.all([
			this.api.get<PlayerState>('/state'),
			this.api.get<Board>('/board'),
			this.api.get<Market>('/market'),
			this.api.get<Collection>('/collection')
		]);
		this.offset = player.now - Date.now() / 1000;
		this.now = player.now;
		this.player = player;
		this.board = board;
		this.market = market;
		this.collection = collection;
	}

	// ── 파생 값 ───────────────────────────────────────
	get slots() {
		return this.player?.workbench.slots.filter((s) => s.unlocked) ?? [];
	}

	get resting(): boolean {
		const w = this.player?.workbench;
		return !!w && w.used_today >= w.limit;
	}

	get boardRun() {
		return (this.player?.queue ?? []).find((r) => r.source === 'board') ?? null;
	}

	get claimable(): number {
		const runs = (this.player?.queue ?? []).filter((r) => r.ends_at <= this.now).length;
		return runs + this.slots.reduce((n, s) => n + s.pending, 0);
	}

	get chainPostings() {
		return this.board.postings.filter((p) => p.chain);
	}

	/** 지금 예약할 수 있는 상시 임무 (취미 전부 + 가진 직업의 상시 임무) */
	get routineTemplates(): Template[] {
		const p = this.player;
		if (!this.catalog || !p) return [];
		const gear = p.equipment.map((name) => this.catalog!.shop[name] ?? 0);
		return this.catalog.templates.filter(
			(t) =>
				t.type === 'ROUTINE' &&
				t.tier !== 'BUSINESS' &&
				(t.tier === 'HOBBY' || t.line in p.jobs) &&
				(t.gear === 0 || gear.some((g) => g >= t.gear))
		);
	}

	// ── 명령 ─────────────────────────────────────────
	private async run(fn: () => Promise<unknown>, done?: string): Promise<void> {
		this.busy = true;
		try {
			await fn();
			if (done) this.say(done);
		} catch (e) {
			this.say(e instanceof ApiError ? e.message : '알 수 없는 오류가 났습니다');
		} finally {
			this.busy = false;
			await this.refresh().catch(() => (this.online = false));
		}
	}

	setWork(slot: number, templateId: string) {
		const name = this.catalog?.templates.find((t) => t.id === templateId)?.name ?? '임무';
		return this.run(() => this.api.command('POST', `/workbench/${slot}`, { template_id: templateId }), `작업대 ${slot + 1}에 ${name}`);
	}

	stopWork(slot: number) {
		return this.run(() => this.api.command('DELETE', `/workbench/${slot}`), `작업대 ${slot + 1}을 비웠어요`);
	}

	/** 탭 가속: 조용히 처리하고 실패만 알린다 */
	async tapWork(slot: number) {
		try {
			await this.api.command('POST', `/workbench/${slot}/tap`);
		} catch (e) {
			if (e instanceof ApiError) this.say(e.message);
		}
		await this.refresh().catch(() => {});
	}

	accept(postingId: string) {
		return this.run(() => this.api.command('POST', `/board/${postingId}/accept`), '수락했습니다. 3분 뒤 완료돼요');
	}

	claim() {
		return this.run(async () => {
			const r = await this.api.command<{
				claimed: { reward?: number; outcome?: string | null; drop?: { name: string; registered: boolean } }[];
			}>('POST', '/claims');
			const total = r.claimed.reduce((s, c) => s + (c.reward ?? 0), 0);
			const found = r.claimed.find((c) => c.drop?.registered)?.drop?.name;
			const best = highlights(r.claimed.map((c) => c.outcome));
			this.say(
				[`${r.claimed.length}건 받음 · +${Math.round(total)} G`, best, found && `도감에 ${found} 등록`].filter(Boolean).join(' · ')
			);
		});
	}

	takeJob(line: string) {
		return this.run(() => this.api.command('POST', `/jobs/${line}`), '직업을 시작했습니다');
	}

	promote(line: string) {
		return this.run(() => this.api.command('POST', `/jobs/${line}/promote`), '승급했습니다');
	}

	buy(item: string) {
		return this.run(() => this.api.command('POST', '/shop/buy', { item }), `${item} 구매`);
	}

	openBusiness(line: string) {
		return this.run(() => this.api.command('POST', '/businesses', { line }), '사업을 열었습니다');
	}

	abandon(runId: number) {
		return this.run(() => this.api.command('DELETE', `/runs/${runId}`), '의뢰를 포기했어요 (명성 −3)');
	}

	hire(index: number) {
		return this.run(() => this.api.command('POST', `/businesses/${index}/hire`), '일꾼을 고용했어요');
	}

	upgrade(line: string) {
		const name = this.catalog?.lines[line] ?? line;
		return this.run(() => this.api.command('POST', `/buildings/${line}/upgrade`), `${name} 건물을 확장했어요`);
	}

	collect() {
		return this.run(async () => {
			const r = await this.api.command<{ settled: number; net?: number }>('POST', '/businesses/collect');
			this.say(r.settled ? `정산 ${r.settled}회 · ${Math.round(r.net ?? 0)} G` : '받을 정산이 없습니다');
		});
	}

	/** 돌아왔을 때 화면에서 한 번에 받기: 받은 돈, 오른 레벨, 새 도감을 함께 보여 준다 */
	async claimAway(): Promise<void> {
		const before = this.player!;
		const lv = Object.fromEntries(Object.entries(before.skills).map(([l, s]) => [l, s.level]));
		try {
			const r = await this.api.command<{ claimed: { drop?: { name: string; registered: boolean } }[]; money: number }>('POST', '/claims');
			await this.refresh();
			const levels = Object.entries(this.player!.skills)
				.filter(([l, s]) => s.level > lv[l])
				.map(([l, s]) => `${this.catalog!.lines[l]} Lv ${s.level}`);
			const drops = r.claimed.flatMap((c) => (c.drop?.registered ? [c.drop.name] : []));
			const best = highlights((r.claimed as { outcome?: string | null }[]).map((c) => c.outcome));
			if (this.away) this.away.result = { gained: r.money - before.money, levels: best ? [...levels, best] : levels, drops };
		} catch (e) {
			this.say(e instanceof ApiError ? e.message : '받지 못했어요');
		}
	}

	// ── 세이브 이동 ───────────────────────────────────
	get canTransfer(): boolean {
		return !!this.api.saves;
	}

	exportSave(): void {
		const raw = this.api.saves!.export();
		const day = new Date().toISOString().slice(0, 10);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
		a.download = `life_normal-${day}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		this.say('세이브 파일을 저장했어요');
	}

	async importSave(file: File): Promise<void> {
		try {
			this.api.saves!.import(await file.text());
			await this.refresh();
			this.say('세이브를 불러왔어요');
		} catch (e) {
			this.say(e instanceof ApiError ? e.message : '세이브를 불러오지 못했어요');
		}
	}

	async resetSave(): Promise<void> {
		this.api.saves!.reset();
		await this.refresh();
		this.say('처음부터 시작합니다');
	}

	say(msg: string) {
		this.toast = msg;
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => (this.toast = null), 2600);
	}

	// ── 알림 ─────────────────────────────────────────
	private onEvent(e: GameEvent) {
		if (e.type === 'mission.done') this.say(e.resting ? `임무 ${e.count}건 완료 · 오늘 한도에 닿아 쉬어요` : `임무 ${e.count}건 완료`);
		else if (e.type === 'event.started' || e.type === 'event.step') this.say(e.text);
		else if (e.type === 'settlement.ready') this.say('사업 정산이 하루치 쌓였어요');
		void this.refresh();
	}
}
