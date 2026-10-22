import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// 정적 사이트: 게임 전체가 브라우저 안에서 돈다 (GitHub Pages에 그대로 배포)
		adapter: adapter({ fallback: '404.html' }),
		// GitHub Pages 프로젝트 사이트는 /저장소이름/ 아래에서 서비스된다
		paths: { base: process.env.BASE_PATH ?? '' },
		serviceWorker: { register: true }
	}
};
