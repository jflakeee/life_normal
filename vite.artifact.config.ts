// 게임 전체를 HTML 파일 하나로 묶는다 (외부 파일 없이 열리는 배포용). 결과: dist-artifact/index.html
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
	root: 'artifact',
	plugins: [svelte(), viteSingleFile()],
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	build: { outDir: '../dist-artifact', emptyOutDir: true }
});
