import { expect, test } from '@playwright/test';

// 경로는 baseURL(/life_normal/) 기준 상대 경로로 쓴다
test('작업대에 임무를 올리면 반복하고, 탭으로 당길 수 있고, 새로고침해도 남는다', async ({ page }) => {
	await page.goto('./');
	await expect(page.getByLabel('작업대', { exact: true })).toBeVisible();
	await expect(page.getByText('오늘 0/120건')).toBeVisible();

	await page.getByRole('button', { name: '임무' }).click();
	const parcel = page.getByRole('listitem').filter({ hasText: '소포 배달' });
	await parcel.getByRole('button', { name: '작업대 1에 올리기' }).click();
	await expect(page.getByRole('status')).toHaveText('작업대 1에 소포 배달');
	await expect(page.getByText('작업대: 1 소포 배달')).toBeVisible();

	await page.getByRole('button', { name: '홈' }).click();
	const ring = page.getByRole('button', { name: /탭해서 10초 당기기: 소포 배달, 남은 (\d+):(\d+)/ });
	await expect(ring).toBeVisible();
	await ring.click();
	await expect(ring).toHaveAccessibleName(/남은 2:[45]\d/); // 3:00 → 10초 당김
	await expect(page.getByRole('button', { name: '받을 보상 없음' })).toBeDisabled();

	await page.reload(); // 저장(localStorage) 확인
	await expect(page.getByRole('button', { name: /탭해서 10초 당기기: 소포 배달/ })).toBeVisible();
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
	await parcel.getByRole('button', { name: '작업대 1에 올리기' }).click();
	await expect(page.getByText('작업대: 1 소포 배달')).toBeVisible();

	await page.getByRole('button', { name: '나' }).click();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '내보내기' }).click()]);
	const file = await download.path();

	await page.getByRole('button', { name: '처음부터 다시' }).click();
	await page.getByRole('button', { name: '임무' }).click();
	await expect(page.getByText('작업대: 1 비어 있음')).toBeVisible();

	await page.getByRole('button', { name: '나' }).click();
	await page.locator('input[type=file]').setInputFiles(file);
	await expect(page.getByRole('status')).toHaveText('세이브를 불러왔어요');
	await page.getByRole('button', { name: '임무' }).click();
	await expect(page.getByText('작업대: 1 소포 배달')).toBeVisible();
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
	await expect(page.getByText(/^작업대:/)).toBeVisible();
});

test('자리를 비웠다 돌아오면 요약이 뜨고, 한 번에 받으면 결과를 보여 준다', async ({ page }) => {
	await page.goto('./#missions');
	await page.getByRole('listitem').filter({ hasText: '소포 배달' }).getByRole('button', { name: '작업대 1에 올리기' }).click();
	await expect(page.getByText('작업대: 1 소포 배달')).toBeVisible();
	// 2시간 자리를 비운 것처럼 저장 상태의 시각을 되돌린다
	await page.evaluate(() => {
		const d = JSON.parse(localStorage.getItem('dm.save')!);
		for (const s of d.workbench.slots) s.lastTick -= 7200;
		d.lastActive -= 7200;
		localStorage.setItem('dm.save', JSON.stringify(d));
	});
	await page.goto('./#home');
	await page.reload();
	const sheet = page.getByRole('dialog', { name: /자리를 비운 동안 · 2시간/ });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByText('끝낸 작업 40건')).toBeVisible();
	// 시트가 열려 있는 동안 뒤 화면은 비활성 (화면 낭독기·키보드가 닿지 않음)
	await expect(page.locator('main button.primary')).not.toBeFocused();
	await expect(page.locator('main')).toHaveAttribute('inert', '');
	await sheet.getByRole('button', { name: '한 번에 받기' }).click();
	await expect(sheet.getByText(/받은 돈 \+\d+ G/)).toBeVisible();
	await sheet.getByRole('button', { name: '확인' }).click();
	await expect(sheet).toBeHidden();
	await expect(page.getByRole('button', { name: '받을 보상 없음' })).toBeDisabled();
});
