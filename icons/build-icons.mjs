/*
 * icons/icon.svg 하나로 앱 아이콘 파일들을 만듭니다.
 *
 *   node icons/build-icons.mjs
 *
 * 그림을 바꾸고 싶으면 icon.svg 만 고친 뒤 이 명령을 다시 돌리세요.
 * (playwright 가 깔려 있어야 합니다: npm i -D playwright)
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const svg = fs.readFileSync(path.join(HERE, 'icon.svg'), 'utf8');

/*
 * 안드로이드는 아이콘을 동그랗게/네모나게 제멋대로 잘라냅니다(maskable).
 * 잘려도 그림이 살아남도록, 가장자리에 안전 여백을 두고 한 번 더 만듭니다.
 *
 * 배경이 비어 있으므로, 잘라내는 쪽(런처)의 바탕이 그대로 비칩니다.
 * 바탕을 넣고 싶으면 icon.svg 맨 앞에 <rect width="512" height="512" fill="..."/> 를 넣으세요.
 */
const SAFE_PAD = 0.14;

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'icon-maskable-192.png', size: 192, pad: SAFE_PAD },
  { file: 'icon-maskable-512.png', size: 512, pad: SAFE_PAD },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 }
];

// 크롬 위치를 따로 정해야 하는 환경이면 CHROMIUM_PATH 로 알려 주세요.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);

for (const { file, size, pad } of targets) {
  const inner = Math.round(size * (1 - pad * 2));
  const offset = Math.round(size * pad);
  const page = await browser.newPage({ viewport: { width: size, height: size } });

  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;background:transparent">
    <div style="position:absolute;left:${offset}px;top:${offset}px;width:${inner}px;height:${inner}px">
      ${svg.replace(/width="512" height="512"/, `width="${inner}" height="${inner}"`)}
    </div></body></html>`);

  // 배경을 비워 둡니다. 말풍선만 남습니다.
  await page.screenshot({ path: path.join(HERE, file), omitBackground: true });
  await page.close();
  console.log(`  ${file}  ${size}x${size}${pad ? ' (여백 있음)' : ''}`);
}

await browser.close();
