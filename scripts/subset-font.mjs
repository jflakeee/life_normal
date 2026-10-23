// 갈무리(OFL) 글꼴을 게임에 실제로 쓰인 글자만 남겨 src/lib/fonts/에 만든다.
// 새 글자를 쓰면 `npm run fonts`로 다시 만든다 (빠뜨리면 font.test.ts가 실패한다).
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import subsetFont from 'subset-font';

const SRC = 'node_modules/galmuri/dist';
const FONTS = [
	['Galmuri11-Bold.woff2', 'galmuri11-bold.woff2'],
	['Galmuri14.woff2', 'galmuri14.woff2']
];

const files = [];
const walk = (d) =>
	readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk('src');
const text = files
	.filter((f) => /\.(svelte|ts|json)$/.test(f) && !f.includes('.test.'))
	.map((f) => readFileSync(f, 'utf8'))
	.join('');
const hangul = [...new Set(text.match(/[\uac00-\ud7a3]/g))].sort().join('');
const ascii = Array.from({ length: 0x5f }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const keep = hangul + ascii + '·…→←▲▼★×−';

for (const [from, to] of FONTS) {
	const out = await subsetFont(readFileSync(join(SRC, from)), keep, { targetFormat: 'woff2' });
	writeFileSync(join('src/lib/fonts', to), out);
	console.log(`${to}: ${(out.length / 1024).toFixed(1)} KB`);
}
writeFileSync('src/lib/fonts/chars.txt', keep);
copyFileSync('node_modules/galmuri/ofl.md', 'src/lib/fonts/OFL.md');
console.log(`한글 ${hangul.length}자`);
