// 進み具合のページを作る（site/progress.html と、全ブランチの入口 site/_root/index.html）。
// GitHub の自動処理（.github/workflows/preview.yml）が、ビルドと動画の撮影の後に動かす。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const branch = process.env.GITHUB_REF_NAME || sh('git rev-parse --abbrev-ref HEAD') || 'main';
const commit = sh('git log -1 --format=%h');
const when = sh('git log -1 --format=%cd --date=format:%Y-%m-%d_%H:%M').replace('_', ' ');
const subject = sh('git log -1 --format=%s');

const ROLES = {
  main: { name: '本線（取り込み済みの物）', file: 'LEAD', video: 'game' },
  'team-b': { name: '担当 B: 盤面と照準', file: 'B', video: 'board' },
  'team-c': { name: '担当 C: 演出と音', file: 'C', video: 'effects' },
  'team-d': { name: '担当 D: 画面・保存・ランキング', file: 'D', video: 'screens' },
};
const role = ROLES[branch] ?? { name: branch, file: 'LEAD', video: 'game' };

/** progress の「## いま」「## つぎ」の本文を取り出す。 */
async function section(title) {
  try {
    const text = await readFile(`docs/progress/${role.file}.md`, 'utf8');
    const m = text.match(new RegExp(`## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`));
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

const STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #070b18; color: #f7f7f2; font-family: "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, sans-serif; line-height: 1.7; }
  main { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 8px; color: #ffb45e; }
  .sub { color: #91a0b8; font-size: 13px; }
  .card { border: 1px solid #39506a; border-radius: 12px; padding: 12px 16px; background: #101a30; white-space: pre-wrap; }
  a { color: #83d9ff; }
  .links a { display: inline-block; margin: 0 12px 8px 0; padding: 6px 14px; border: 1px solid #39506a; border-radius: 999px; text-decoration: none; }
  video { width: 100%; border: 1px solid #39506a; border-radius: 12px; background: #000; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
  .note { color: #91a0b8; font-size: 13px; }
`;

const videos = [
  ['game', 'ゲーム本体（自動で遊ばせた物）'],
  ['board', '見本ページ: 盤面と照準（担当 B）'],
  ['effects', '見本ページ: 演出と音（担当 C）'],
  ['screens', '見本ページ: 画面（担当 D）'],
];
// このブランチの担当の動画を先頭に出す
videos.sort((a, b) => (b[0] === role.video ? 1 : 0) - (a[0] === role.video ? 1 : 0));

const now = await section('いま');
const next = await section('つぎ');

const page = `<!doctype html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(role.name)} | GRAVITY CORE の進み具合</title><style>${STYLE}</style></head>
<body><main>
<p class="sub"><a href="../">全体の一覧へ</a></p>
<h1>${esc(role.name)}</h1>
<p class="sub">更新 ${esc(when)}（${esc(commit)}　${esc(subject)}）</p>

<h2>いま</h2><div class="card">${esc(now || '（記録なし）')}</div>
<h2>つぎ</h2><div class="card">${esc(next || '（記録なし）')}</div>

<h2>触ってみる</h2>
<p class="links">
  <a href="index.html">ゲーム本体</a>
  <a href="dev/board.html">見本: 盤面と照準</a>
  <a href="dev/effects.html">見本: 演出と音</a>
  <a href="dev/screens.html">見本: 画面</a>
  <a href="ranking.html">ランキング</a>
</p>
<p class="note">その場で動きます。音は、ここで実際に触ると聞けます（動画には入りません）。</p>

<h2>動画</h2>
<div class="grid">
${videos.map(([file, label]) => `  <figure style="margin:0"><video src="videos/${file}.webm" poster="videos/${file}.png" controls muted playsinline preload="none"></video><figcaption class="note">${esc(label)}</figcaption></figure>`).join('\n')}
</div>
</main></body></html>
`;
await writeFile('site/progress.html', page);

const root = `<!doctype html>
<html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GRAVITY CORE の進み具合</title><style>${STYLE}</style></head>
<body><main>
<h1>GRAVITY CORE の進み具合</h1>
<p class="sub">担当ごとの最新の状態です。GitHub に保存（push）されるたびに、数分で自動的に更新されます。</p>
<h2>見る</h2>
<p class="links">
${Object.entries(ROLES).map(([b, r]) => `  <a href="${b}/progress.html">${esc(r.name)}</a>`).join('\n')}
</p>
<p class="note">まだ一度も保存されていない担当のページは、開いても「見つかりません」と出ます。</p>
</main></body></html>
`;
await mkdir('site/_root', { recursive: true });
await writeFile('site/_root/index.html', root);
console.log(`progress.html を作りました（${branch}）`);
