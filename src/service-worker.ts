/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// 앱 파일을 캐시해 오프라인에서도 열린다. 게임 상태는 localStorage에 있다.
import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `shell-${version}`;
const SHELL = [...build, ...files, `${base}/`];

sw.addEventListener('install', (e) => {
	e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (e) => {
	const url = new URL(e.request.url);
	if (e.request.method !== 'GET' || url.origin !== sw.location.origin) return;
	if (e.request.mode === 'navigate') {
		e.respondWith(fetch(e.request).catch(async () => (await caches.match(`${base}/`)) ?? Response.error()));
		return;
	}
	if (SHELL.includes(url.pathname)) {
		e.respondWith(caches.match(e.request).then((hit) => hit ?? fetch(e.request)));
	}
});
