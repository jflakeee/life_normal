/** 픽셀 글꼴 부분 집합이 게임에 쓰인 한글을 모두 담고 있는지 (새 글자를 쓰면 npm run fonts) */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('covers every Hangul character used in the game', () => {
	const files: string[] = [];
	const walk = (d: string) =>
		readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
	walk('src');
	const used = new Set(
		files
			.filter((f) => /\.(svelte|ts|json)$/.test(f) && !f.includes('.test.'))
			.flatMap((f) => readFileSync(f, 'utf8').match(/[\uac00-\ud7a3]/g) ?? [])
	);
	const covered = new Set(readFileSync('src/lib/fonts/chars.txt', 'utf8'));
	const missing = [...used].filter((c) => !covered.has(c));
	expect(missing, '`npm run fonts`로 글꼴 부분 집합을 다시 만드세요').toEqual([]);
});
