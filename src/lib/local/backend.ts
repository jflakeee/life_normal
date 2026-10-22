/** 브라우저 안 백엔드: 서버 API와 같은 경로·응답을 LocalGame으로 처리한다.
 *  나중에 멀티플레이 서버를 붙여도 클라이언트는 같은 Backend 인터페이스를 쓴다. */
import { ApiError, type Backend, type ServerEvent } from '$lib/api';
import * as svc from './service';
import { GameError, LocalGame, type SaveData, type Session, type Store } from './service';

type Handler = (m: RegExpMatchArray, body: Record<string, unknown>) => (s: Session) => unknown;

// 서버 API와 1:1 대응하는 경로
const ROUTES: [method: string, pattern: RegExp, command: boolean, handler: Handler][] = [
	['GET', /^\/state$/, false, () => svc.state],
	['GET', /^\/board$/, false, () => svc.board],
	['GET', /^\/market$/, false, () => svc.market],
	['GET', /^\/collection$/, false, () => svc.collection],
	['POST', /^\/queue$/, true, (_, b) => (s) => svc.enqueue(s, String(b.template_id), Number(b.count ?? 1))],
	['DELETE', /^\/queue\/(\d+)$/, true, (m) => (s) => svc.cancel(s, Number(m[1]))],
	['POST', /^\/board\/([\w-]+)\/accept$/, true, (m) => (s) => svc.accept(s, m[1])],
	['POST', /^\/claims$/, true, () => svc.claim],
	['POST', /^\/jobs\/(\w+)$/, true, (m) => (s) => svc.takeJob(s, m[1])],
	['POST', /^\/jobs\/(\w+)\/promote$/, true, (m) => (s) => svc.promote(s, m[1])],
	['POST', /^\/businesses$/, true, (_, b) => (s) => svc.openBusiness(s, String(b.line))],
	['POST', /^\/businesses\/collect$/, true, () => svc.collect],
	['POST', /^\/shop\/buy$/, true, (_, b) => (s) => svc.buy(s, String(b.item))]
];

export function localStore(key = 'dm.save'): Store {
	return {
		load: () => {
			try {
				const raw = localStorage.getItem(key);
				return raw ? (JSON.parse(raw) as SaveData) : null;
			} catch {
				return null;
			}
		},
		save: (d) => {
			try {
				localStorage.setItem(key, JSON.stringify(d));
			} catch {
				/* 저장 공간이 없으면 이번 세션 동안만 유지 */
			}
		}
	};
}

export interface LocalBackendOptions {
	store?: Store;
	clock?: () => number;
	seed?: string;
	newKey?: () => string;
	pollMs?: number;
}

export function createLocalBackend(opts: LocalBackendOptions = {}): Backend & { game: LocalGame; request: typeof request } {
	const game = new LocalGame(opts.store ?? localStore(), opts.clock, opts.seed);
	const newKey = opts.newKey ?? (() => crypto.randomUUID());

	function request<T>(method: string, path: string, body?: unknown, key?: string): T {
		if (method === 'GET' && path === '/catalog') return svc.catalog() as T;
		for (const [verb, pattern, isCommand, handler] of ROUTES) {
			const m = path.match(pattern);
			if (verb !== method || !m) continue;
			const fn = handler(m, (body ?? {}) as Record<string, unknown>);
			try {
				if (!isCommand) return game.query(fn) as T;
				if (!key) throw new ApiError(400, 'Idempotency-Key 필요');
				return game.command(key, fn)[0] as T;
			} catch (e) {
				if (e instanceof GameError) throw new ApiError(409, e.message);
				throw e;
			}
		}
		throw new ApiError(404, `없는 경로: ${method} ${path}`);
	}

	return {
		game,
		request,
		hasToken: true,
		async login() {},
		async get<T>(path: string) {
			return request<T>('GET', path);
		},
		async command<T>(method: 'POST' | 'DELETE', path: string, body?: unknown) {
			return request<T>(method, path, body, newKey());
		},
		subscribe(onEvent: (e: ServerEvent) => void, onStatus: (online: boolean) => void) {
			const cursor: Record<string, unknown> = {};
			const tick = () => {
				const events = game.query((s) => svc.notifications(s, cursor));
				for (const e of events) onEvent(e as ServerEvent);
			};
			tick();
			onStatus(true);
			const id = setInterval(tick, opts.pollMs ?? 3000);
			return () => clearInterval(id);
		}
	};
}
