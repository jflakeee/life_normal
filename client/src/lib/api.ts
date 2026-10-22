/** 서버 API 클라이언트: 게스트 로그인, 멱등 명령, 네트워크 재시도 */

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export interface KeyValue {
	get(key: string): string | null;
	set(key: string, value: string): void;
	remove(key: string): void;
}

export interface ApiOptions {
	base?: string;
	fetch?: typeof fetch;
	storage?: KeyValue;
	sleep?: (ms: number) => Promise<void>;
	newKey?: () => string;
	retries?: number;
}

const TOKEN = 'dm.token';

function browserStorage(): KeyValue {
	const mem = new Map<string, string>();
	return {
		get: (k) => {
			try {
				return localStorage.getItem(k);
			} catch {
				return mem.get(k) ?? null;
			}
		},
		set: (k, v) => {
			try {
				localStorage.setItem(k, v);
			} catch {
				mem.set(k, v);
			}
		},
		remove: (k) => {
			try {
				localStorage.removeItem(k);
			} catch {
				mem.delete(k);
			}
		}
	};
}

export function createApi(opts: ApiOptions = {}) {
	const base = opts.base ?? '';
	const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
	const storage = opts.storage ?? browserStorage();
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const newKey = opts.newKey ?? (() => crypto.randomUUID());
	const retries = opts.retries ?? 3;

	async function send<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		const token = storage.get(TOKEN);
		if (token) headers.Authorization = `Bearer ${token}`;
		if (key) headers['Idempotency-Key'] = key;
		for (let attempt = 0; ; attempt++) {
			let res: Response;
			try {
				res = await doFetch(base + path, {
					method,
					headers,
					body: body === undefined ? undefined : JSON.stringify(body)
				});
			} catch (e) {
				// 네트워크 오류: 같은 Idempotency-Key로 다시 보내므로 서버는 한 번만 처리한다
				if (attempt >= retries - 1) throw new ApiError(0, '연결할 수 없습니다. 네트워크를 확인하세요.');
				await sleep(400 * 2 ** attempt);
				continue;
			}
			const data = await res.json().catch(() => ({}));
			if (res.ok) return data as T;
			if (res.status === 401) storage.remove(TOKEN);
			throw new ApiError(res.status, data.error ?? data.detail ?? `요청 실패 (${res.status})`);
		}
	}

	return {
		get hasToken() {
			return storage.get(TOKEN) !== null;
		},
		async login(): Promise<void> {
			if (storage.get(TOKEN)) return;
			const acc = await send<{ token: string }>('POST', '/auth/guest');
			storage.set(TOKEN, acc.token);
		},
		get<T>(path: string): Promise<T> {
			return send<T>('GET', path);
		},
		command<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
			return send<T>(method, path, body, newKey());
		},
		wsUrl(origin: string): string {
			const url = new URL('/ws', origin);
			url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
			url.searchParams.set('token', storage.get(TOKEN) ?? '');
			return url.toString();
		}
	};
}

export type Api = ReturnType<typeof createApi>;
