import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, type KeyValue } from './api';

function memory(): KeyValue {
	const m = new Map<string, string>();
	return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('api', () => {
	it('logs in once and sends the bearer token', async () => {
		const fetch = vi.fn().mockResolvedValueOnce(ok({ token: 't1' })).mockResolvedValueOnce(ok({ money: 1 }));
		const api = createApi({ fetch, storage: memory() });
		await api.login();
		await api.login();
		await api.get('/state');
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer t1');
	});

	it('retries a command after a network error with the same Idempotency-Key', async () => {
		const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(ok({ claimed: [] }));
		let n = 0;
		const api = createApi({ fetch, storage: memory(), sleep: async () => {}, newKey: () => `key-${n++}` });
		await api.command('POST', '/claims');
		const keys = fetch.mock.calls.map((c) => c[1].headers['Idempotency-Key']);
		expect(keys).toEqual(['key-0', 'key-0']);
	});

	it('gives up after the retry budget with a readable error', async () => {
		const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
		const api = createApi({ fetch, storage: memory(), sleep: async () => {}, retries: 3 });
		await expect(api.command('POST', '/claims')).rejects.toMatchObject({ status: 0 });
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('surfaces server rule errors and drops a rejected token', async () => {
		const storage = memory();
		storage.set('dm.token', 'old');
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ error: '대기열은 최대 20건' }), { status: 409 }))
			.mockResolvedValueOnce(new Response('{}', { status: 401 }));
		const api = createApi({ fetch, storage });
		await expect(api.command('POST', '/queue', {})).rejects.toEqual(new ApiError(409, '대기열은 최대 20건'));
		await expect(api.get('/state')).rejects.toBeInstanceOf(ApiError);
		expect(storage.get('dm.token')).toBeNull();
	});

	it('builds a ws url with the token', () => {
		const storage = memory();
		storage.set('dm.token', 'abc');
		const api = createApi({ storage });
		expect(api.wsUrl('https://game.example')).toBe('wss://game.example/ws?token=abc');
	});
});
