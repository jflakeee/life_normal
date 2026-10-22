/** 게임 상태: 서버가 진실이고, 여기는 마지막으로 받은 스냅숏과 표시용 시계만 가진다. */
import { ApiError, createApi, type Api } from './api';
import type { Board, Catalog, Collection, Market, PlayerState, Template } from './types';

type WsEvent =
	| { type: 'mission.done'; count: number; queue_empty: boolean }
	| { type: 'event.started' | 'event.step'; text: string }
	| { type: 'market.changed'; prices: Record<string, number> }
	| { type: 'settlement.ready' };

export class Game {
	catalog = $state<Catalog | null>(null);
	player = $state<PlayerState | null>(null);
	board = $state<Board>({ postings: [], events: [] });
	market = $state<Market>({});
	collection = $state<Collection>({});
	toast = $state<string | null>(null);
	busy = $state(false);
	online = $state(true);
	/** 서버 시각 기준 현재 (1초마다 갱신) */
	now = $state(0);

	private offset = 0; // 서버 시각 - 기기 시각
	private ws: WebSocket | null = null;
	private retry = 0;
	private toastTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private api: Api = createApi()) {}

	async start(): Promise<void> {
		await this.api.login();
		this.catalog = await this.api.get<Catalog>('/catalog');
		await this.refresh();
		setInterval(() => (this.now = Date.now() / 1000 + this.offset), 1000);
		// 알림 연결이 끊겨 있는 동안에는 30초마다 직접 상태를 받는다
		setInterval(() => {
			if (!this.online && document.visibilityState === 'visible') void this.refresh().catch(() => {});
		}, 30_000);
		this.connect();
		document.addEventListener('visibilitychange', () => {
			// 앱으로 돌아오면 스냅숏부터 받고 알림을 다시 연결한다
			if (document.visibilityState === 'visible') {
				void this.refresh();
				if (!this.ws) this.connect();
			}
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
	get queueRuns() {
		return (this.player?.queue ?? []).filter((r) => r.source === 'queue');
	}

	get boardRun() {
		return (this.player?.queue ?? []).find((r) => r.source === 'board') ?? null;
	}

	get claimable(): number {
		return (this.player?.queue ?? []).filter((r) => r.ends_at <= this.now).length;
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

	queue(templateId: string, count = 1) {
		const name = this.catalog?.templates.find((t) => t.id === templateId)?.name ?? '임무';
		return this.run(() => this.api.command('POST', '/queue', { template_id: templateId, count }), `${name} ${count}건 예약`);
	}

	fillQueue(templateId: string) {
		const free = (this.catalog?.queue_limit ?? 20) - this.queueRuns.length;
		if (free <= 0) return this.say('대기열이 가득 찼습니다. 완료된 보상을 먼저 받으세요');
		return this.queue(templateId, free);
	}

	cancel(runId: number) {
		return this.run(() => this.api.command('DELETE', `/queue/${runId}`), '예약 취소');
	}

	accept(postingId: string) {
		return this.run(() => this.api.command('POST', `/board/${postingId}/accept`), '수락했습니다. 3분 뒤 완료돼요');
	}

	claim() {
		return this.run(async () => {
			const r = await this.api.command<{ claimed: { reward?: number; drop?: { name: string; registered: boolean } }[] }>(
				'POST',
				'/claims'
			);
			const total = r.claimed.reduce((s, c) => s + (c.reward ?? 0), 0);
			const found = r.claimed.find((c) => c.drop?.registered)?.drop?.name;
			this.say(found ? `${r.claimed.length}건 받음 · 도감에 ${found} 등록` : `${r.claimed.length}건 받음 · +${Math.round(total)} G`);
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

	collect() {
		return this.run(async () => {
			const r = await this.api.command<{ settled: number; net?: number }>('POST', '/businesses/collect');
			this.say(r.settled ? `정산 ${r.settled}회 · ${Math.round(r.net ?? 0)} G` : '받을 정산이 없습니다');
		});
	}

	say(msg: string) {
		this.toast = msg;
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => (this.toast = null), 2600);
	}

	// ── 알림 ─────────────────────────────────────────
	private connect() {
		const ws = new WebSocket(this.api.wsUrl(location.origin));
		this.ws = ws;
		ws.onopen = () => {
			this.online = true;
			this.retry = 0;
			void this.refresh().catch(() => {}); // 끊긴 사이에 놓친 것을 스냅숏으로 복구
		};
		ws.onmessage = (m) => this.onEvent(JSON.parse(m.data) as WsEvent);
		ws.onclose = () => {
			this.ws = null;
			if (document.visibilityState !== 'visible') return; // 백그라운드에서는 다시 열지 않는다
			this.online = false;
			const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
			setTimeout(() => this.connect(), wait);
		};
	}

	private onEvent(e: WsEvent) {
		if (e.type === 'mission.done') this.say(e.queue_empty ? '대기열 임무를 모두 마쳤어요' : `임무 ${e.count}건 완료`);
		else if (e.type === 'event.started' || e.type === 'event.step') this.say(e.text);
		else if (e.type === 'settlement.ready') this.say('사업 정산이 하루치 쌓였어요');
		void this.refresh();
	}
}
