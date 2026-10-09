// 進み具合の動画を自動で撮る（npm run capture）。先に npm run build:preview で site/ を作っておく。
// GitHub の自動処理（.github/workflows/preview.yml）が push のたびに動かす。手元で動かしてもよい。
//
// 撮るもの（site/videos/ に webm で出す。音は入らない）:
//   game.webm     ゲーム本体を自動で遊ぶ
//   board.webm    担当 B の見本ページ
//   effects.webm  担当 C の見本ページ
//   screens.webm  担当 D の見本ページ
//
// 見本ページでは、上の操作バー（#demo-controls）にあるボタンを左から順に全部押す。
// 担当がボタンを足せば、それも自動で動画に入る。

import { createServer } from 'node:http';
import { readFile, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = 'site';
const OUT = join(ROOT, 'videos');
const SIZE = { width: 960, height: 720 };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webm': 'video/webm', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(ROOT, path === '' ? 'index.html' : path);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** 盤面の中心と、論理座標 1 あたりの画面上の長さを求める。 */
async function boardGeometry(page) {
  const box = await page.locator('#board').boundingBox();
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2, k: box.width / 960 };
}

/** 角度 angle の方角（半径 300 の位置）を押し、(dx, dy) だけ引いて離す。 */
async function shoot(page, geo, angle, dx = 0, dy = 0) {
  const x = geo.cx + Math.cos(angle) * 300 * geo.k;
  const y = geo.cy + Math.sin(angle) * 300 * geo.k;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (dx !== 0 || dy !== 0) {
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
      await sleep(45);
    }
    await sleep(350);
  } else {
    await sleep(250);
  }
  await page.mouse.up();
}

/** 操作バーのボタンを左から順に全部押す。 */
async function pressAllButtons(page, gapMs, limitMs) {
  const started = Date.now();
  const count = await page.locator('#demo-controls button').count();
  for (let i = 0; i < count && Date.now() - started < limitMs; i++) {
    const button = page.locator('#demo-controls button').nth(i);
    const label = (await button.textContent())?.trim() ?? '';
    if (/ランキングページを開く|記録を全部消す/.test(label)) continue; // ページを離れる・消す操作は撮らない
    await button.click({ timeout: 2000 }).catch(() => {});
    await sleep(gapMs);
  }
}

const scenarios = {
  async game(page) {
    await page.goto(`${base}/index.html`);
    await sleep(800);
    await page.getByRole('button').first().click().catch(() => {});
    await sleep(600);
    const geo = await boardGeometry(page);
    await shoot(page, geo, -Math.PI / 2); // 最初の 1 射で合体
    await sleep(900);
    for (let i = 0; i < 26; i++) {
      const angle = -Math.PI / 2 + i * 2.4;
      if (i % 4 === 3) await shoot(page, geo, angle, Math.cos(angle + 1.9) * 90, Math.sin(angle + 1.9) * 90);
      else await shoot(page, geo, angle);
      await sleep(620);
    }
    await sleep(1500);
  },
  async board(page) {
    await page.goto(`${base}/dev/board.html`);
    await sleep(600);
    await pressAllButtons(page, 1100, 16000);
    await page.locator('#demo-controls button').nth(4).click().catch(() => {}); // 山ができた盤面で照準を見せる
    await sleep(600);
    const geo = await boardGeometry(page);
    await shoot(page, geo, -0.6);
    await sleep(900);
    await shoot(page, geo, 2.2, -60, -80);
    await sleep(900);
    await shoot(page, geo, 0.9, -90, 30);
    await sleep(1500);
  },
  async effects(page) {
    await page.goto(`${base}/dev/effects.html`);
    await sleep(600);
    await pressAllButtons(page, 1300, 40000);
    await sleep(6000);
  },
  async screens(page) {
    await page.goto(`${base}/dev/screens.html`);
    await sleep(800);
    await pressAllButtons(page, 1500, 40000);
    await page.goto(`${base}/ranking.html`);
    await sleep(2500);
  },
};

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
for (const [name, run] of Object.entries(scenarios)) {
  const dir = join(OUT, `_${name}`);
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir, size: SIZE }, locale: 'ja-JP' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await run(page);
    // 最後の画面を 1 枚残す（動画の表紙に使う）
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  } catch (e) {
    failed++;
    console.error(`[${name}] 撮影中に失敗: ${e}`);
  }
  await context.close();
  const [file] = await readdir(dir);
  if (file) await rename(join(dir, file), join(OUT, `${name}.webm`));
  else failed++;
  await rm(dir, { recursive: true, force: true });
  console.log(`[${name}] 撮影完了${errors.length ? `（ページのエラー ${errors.length} 件: ${errors[0]}）` : ''}`);
}
await browser.close();
server.close();
// 動画は「進み具合を見る」ための物なので、1 本失敗しても全体は失敗にしない
console.log(failed ? `${failed} 本は途中で失敗しました` : 'すべて撮れました');
