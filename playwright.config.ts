import { defineConfig } from '@playwright/test';

// GitHub Pages와 같은 하위 경로(/life_normal/)로 빌드한 결과를 360×640 세로 화면에서 검사한다.
const base = '/life_normal';
export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	use: { baseURL: `http://127.0.0.1:8799${base}/`, viewport: { width: 360, height: 640 }, locale: 'ko-KR' },
	webServer: {
		command: 'npm run build && npx vite preview --host 127.0.0.1 --port 8799 --strictPort',
		env: { BASE_PATH: base },
		url: `http://127.0.0.1:8799${base}/`,
		reuseExistingServer: false,
		timeout: 120_000
	}
});
