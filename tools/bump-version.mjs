/*
 * sw.js 의 VERSION 을 오늘 날짜로 올립니다.
 *
 *   npm run release
 *
 * 이 값이 달라져야 이미 설치된 앱이 '새 버전이 있어요'를 띄웁니다.
 * 코드를 고치고 깃허브에 올리기 직전에 한 번 돌려 주세요.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'sw.js';
const source = readFileSync(FILE, 'utf8');

const current = /const VERSION = '([^']+)';/.exec(source);
if (!current) {
  console.error(`${FILE} 에서 VERSION 줄을 찾지 못했습니다.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);   // 2026-09-20

// 같은 날 여러 번 올릴 수 있으니 뒤에 번호를 붙입니다.
const sameDay = current[1].startsWith(today);
const serial = sameDay ? Number(current[1].slice(today.length + 1) || 1) + 1 : 1;
const next = `${today}-${serial}`;

writeFileSync(FILE, source.replace(current[0], `const VERSION = '${next}';`));

console.log(`${FILE}: ${current[1]}  ->  ${next}`);
console.log('이제 깃허브에 올리면 설치된 앱에 알림이 뜹니다.');
