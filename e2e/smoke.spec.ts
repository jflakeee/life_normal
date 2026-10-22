import { expect, test } from '@playwright/test';

// 경로는 baseURL(/life_normal/) 기준 상대 경로로 쓴다
test('임무를 예약하면 도장판에 진행 중 칸이 생기고, 새로고침해도 남는다', async ({ page }) => {
	await page.goto('./');
	await expect(page.getByLabel('대기열 도장판')).toBeVisible();
	await expect(page.getByText('비어 있어요')).toBeVisible();

	await page.getByRole('button', { name: '임무' }).click();
	const parcel = page.getByRole('listitem').filter({ hasText: '소포 배달' });
	await parcel.getByRole('button', { name: '+ 예약' }).click();
	await expect(page.getByRole('status')).toHaveText('소포 배달 1건 예약');
	await expect(page.getByText('대기열 1/20')).toBeVisible();

	await page.getByRole('button', { name: '홈' }).click();
	await expect(page.getByLabel('진행 중: 소포 배달')).toBeVisible();
	await expect(page.getByRole('button', { name: '받을 보상 없음' })).toBeDisabled();

	await page.reload(); // 저장(localStorage) 확인
	await expect(page.getByLabel('진행 중: 소포 배달')).toBeVisible();
});

test('탭은 주소의 #과 함께 움직이고 뒤로 가기가 된다', async ({ page }) => {
	await page.goto('./#shop');
	await expect(page.getByRole('heading', { name: '고급 장비' })).toBeVisible();
	await page.goto('./#town');
	await expect(page.getByRole('heading', { name: '오늘 시세' })).toBeVisible();
	await page.goBack();
	await expect(page.getByRole('heading', { name: '고급 장비' })).toBeVisible();
});

test('본문이 가로로 넘치지 않는다 (360px)', async ({ page }) => {
	for (const tab of ['home', 'missions', 'town', 'shop', 'me']) {
		await page.goto(`./#${tab}`);
		await page.waitForSelector('nav');
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
		expect(overflow, tab).toBeLessThanOrEqual(0);
	}
});

test('하위 경로에서 앱 파일과 매니페스트가 열린다', async ({ page, request }) => {
	const res = await request.get('./manifest.webmanifest');
	expect(res.ok()).toBe(true);
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
	await page.goto('./');
	await page.waitForSelector('nav');
	expect(errors).toEqual([]);
});

test('세이브를 내보내고, 처음부터 다시 한 뒤 가져오면 진행이 돌아온다', async ({ page }) => {
	page.on('dialog', (d) => d.accept());
	await page.goto('./#missions');
	const parcel = page.getByRole('listitem').filter({ hasText: '소포 배달' });
	await parcel.getByRole('button', { name: '+ 예약' }).click();
	await expect(page.getByText('대기열 1/20')).toBeVisible();

	await page.getByRole('button', { name: '나' }).click();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '내보내기' }).click()]);
	const file = await download.path();

	await page.getByRole('button', { name: '처음부터 다시' }).click();
	await page.getByRole('button', { name: '임무' }).click();
	await expect(page.getByText('대기열 0/20')).toBeVisible();

	await page.getByRole('button', { name: '나' }).click();
	await page.locator('input[type=file]').setInputFiles(file);
	await expect(page.getByRole('status')).toHaveText('세이브를 불러왔어요');
	await page.getByRole('button', { name: '임무' }).click();
	await expect(page.getByText('대기열 1/20')).toBeVisible();
});

test('홈에 픽셀 마을이 그려지고, 건물을 누르면 임무 탭으로 간다', async ({ page }) => {
	await page.goto('./');
	const canvas = page.locator('canvas');
	await expect(canvas).toHaveAttribute('aria-hidden', 'true');
	// 그림이 실제로 그려졌는지: 캔버스 가운데 픽셀이 투명하지 않다
	await expect
		.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(90, 30, 1, 1).data[3]))
		.toBe(255);
	const box = (await canvas.boundingBox())!;
	await page.mouse.click(box.x + box.width * (90 / 180), box.y + box.height * (30 / 120)); // 건축 집
	await expect(page).toHaveURL(/#missions$/);
	await expect(page.getByText(/대기열 \d+\/20/)).toBeVisible();
});
