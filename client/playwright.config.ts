import { defineConfig } from '@playwright/test';

// 360×640 세로 화면 E2E. 서버가 빌드된 클라이언트를 서빙한다 (npm run build 후 실행).
export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	use: { baseURL: 'http://127.0.0.1:8799', viewport: { width: 360, height: 640 }, locale: 'ko-KR' },
	webServer: {
		command: 'rm -f /tmp/dm-e2e.db* && uv run uvicorn server.app:create_app --factory --port 8799',
		cwd: '..',
		url: 'http://127.0.0.1:8799/catalog',
		env: { DAILY_MISSIONS_DB: '/tmp/dm-e2e.db' },
		reuseExistingServer: false
	}
});
