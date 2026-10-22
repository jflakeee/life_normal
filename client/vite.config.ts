import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// 개발 중에는 API 요청을 FastAPI(8000)로 넘긴다
const api = 'http://127.0.0.1:8000';
const paths = ['/auth', '/state', '/board', '/market', '/collection', '/catalog', '/queue', '/claims', '/jobs', '/businesses', '/shop'];

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			...Object.fromEntries(paths.map((p) => [p, api])),
			'/ws': { target: api.replace('http', 'ws'), ws: true }
		}
	},
	test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
