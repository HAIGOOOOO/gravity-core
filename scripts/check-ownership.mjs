// 担当のブランチ（team-b / team-c / team-d）が、自分の場所以外を変えていないかを調べる。
// 手元でも GitHub の自動チェックでも同じ物を使う。リーダーのブランチは何でも変えられる。
import { execSync } from 'node:child_process';

// 2026-10-16（方針の版 3）から: 3 本の枝はゲーム全体を作ってよい。触ってはいけない場所だけを決める。
const TEAMS = ['team-b', 'team-c', 'team-d'];
const LETTER = { 'team-b': 'B', 'team-c': 'C', 'team-d': 'D' };
const FORBIDDEN = [
  // リーダーの場所
  'src/contracts/',
  'src/game/',
  'src/app/',
  'src/shared/',
  'src/fixtures/',
  'src/main.ts',
  'index.html',
  'src/audio/',
  'src/tools/', // 調整の道具（リーダー用）
  // 決まり
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.preview.config.ts',
  'vite.slow.config.ts',
  '.github/',
  'scripts/',
  'AGENTS.md',
  'SPEC.md',
  'docs/方針.md',
  'docs/手応え.md',
  'docs/research/',
  'docs/RULES.md',
  'docs/TEAM.md',
  'docs/tasks/',
  'docs/review/',
];

// 2026-10-20（方針の版 9）から: ルールを変える題目は C が持つので、C だけ仕組みの場所も触ってよい。
const ALLOW = {
  C: ['src/game/', 'src/contracts/', 'src/shared/', 'src/fixtures/', 'src/audio/', 'docs/RULES.md'],
};

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const branch = process.env.GITHUB_HEAD_REF || sh('git rev-parse --abbrev-ref HEAD');
const team = TEAMS.find((name) => branch === name || branch.startsWith(`${name}/`));
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

const me = LETTER[team];
const others = Object.values(LETTER).filter((x) => x !== me);
// ほかの担当の進み具合と覚え書きも触らない
const allowed = ALLOW[me] ?? [];
const forbidden = [...FORBIDDEN.filter((p) => !allowed.includes(p)), ...others.flatMap((x) => [`docs/progress/${x}.md`, `docs/notes/${x}/`])];
const outside = changed.filter((file) => forbidden.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p)));

if (outside.length > 0) {
  console.error(`「${team}」が触ってはいけない場所を変更しています:`);
  for (const file of outside) console.error(`  - ${file}`);
  console.error('\nこれらの変更を取り消してください（例: git checkout origin/main -- <ファイル>）。');
  console.error('変えてほしい場合は docs/progress の「リーダーへの依頼」に書いてください（AGENTS.md 5 章）。');
  process.exit(1);
}
console.log(`「${team}」の変更は ${changed.length} 件で、すべて触ってよい場所の中です。`);
