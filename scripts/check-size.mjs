// 성능 목표: 첫 화면 JS 150 KB(gzip) 이하. 빌드된 모든 JS 합계로 보수적으로 잰다.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_KB = 150;
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk('build');
const js = files.filter((f) => f.endsWith('.js'));
const kb = gzipSync(Buffer.concat(js.map((f) => readFileSync(f))), { level: 9 }).length / 1024;
console.log(`JS ${js.length}개, gzip ${kb.toFixed(1)} KB / 예산 ${LIMIT_KB} KB`);
if (kb > LIMIT_KB) process.exit(1);
