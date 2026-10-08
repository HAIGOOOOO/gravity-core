// 担当のブランチ（team-b / team-c / team-d）が、自分の場所以外を変えていないかを調べる。
// 手元でも GitHub の自動チェックでも同じ物を使う。リーダーのブランチは何でも変えられる。
import { execSync } from 'node:child_process';

const OWNERS = {
  'team-b': ['src/render/', 'src/input/', 'src/dev/board-demo.ts', 'dev/board.html', 'docs/progress/B.md'],
  'team-c': ['src/effects/', 'src/audio/', 'src/dev/effects-demo.ts', 'dev/effects.html', 'docs/progress/C.md'],
  'team-d': [
    'src/ui/',
    'src/storage/',
    'src/styles/game.css',
    'src/styles/ranking.css',
    'src/ranking.ts',
    'ranking.html',
    'src/dev/screens-demo.ts',
    'dev/screens.html',
    'docs/progress/D.md',
  ],
};

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const branch = process.env.GITHUB_HEAD_REF || sh('git rev-parse --abbrev-ref HEAD');
const team = Object.keys(OWNERS).find((name) => branch === name || branch.startsWith(`${name}/`));
if (!team) {
  console.log(`ブランチ「${branch}」は担当のブランチではないので、調べません。`);
  process.exit(0);
}

const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
let changed;
try {
  // 日本語のファイル名もそのまま出す
  changed = sh(`git -c core.quotepath=false diff --name-only ${base}...HEAD`).split('\n').filter(Boolean);
} catch {
  console.error(`${base} と比べられませんでした。先に「git fetch origin」をしてください。`);
  process.exit(1);
}

const allowed = OWNERS[team];
const outside = changed.filter((file) => !allowed.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p)));

if (outside.length > 0) {
  console.error(`「${team}」が触ってはいけない場所を変更しています:`);
  for (const file of outside) console.error(`  - ${file}`);
  console.error('\nこれらの変更を取り消してください（例: git checkout origin/main -- <ファイル>）。');
  console.error('変えてほしい場合は docs/progress の「リーダーへの依頼」に書いてください（AGENTS.md 5 章）。');
  process.exit(1);
}
console.log(`「${team}」の変更は ${changed.length} 件で、すべて担当の場所の中です。`);
