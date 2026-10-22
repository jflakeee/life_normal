import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// 단일 화면 앱: 서버(FastAPI)가 build/를 그대로 서빙한다
		adapter: adapter({ fallback: 'index.html' }),
		serviceWorker: { register: true }
	}
};
