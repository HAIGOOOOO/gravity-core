// 解放の表。何を・どの条件で解放するかを UNLOCKS の 1 か所に書く。
// 条件は図鑑と記録の値だけを見る純粋関数なので、プレイ中でも同じ形で確かめられる。
// 「遊びの芯は最初から全部使える」方針のため、解放するのは「続ける」まわりの機能だけ。

export type UnlockContext = Readonly<{
  /** これまでにプレイした回数 */
  runs: number;
  /** これまでの最高得点 */
  bestScore: number;
  /** 図鑑で見つけた項目の数 */
  codexFound: number;
  /** 日替わりの本番を済ませた日数 */
  officialDays: number;
}>;

export type UnlockEntry = Readonly<{
  id: string;
  name: string;
  description: string;
  /** 解放条件の説明（見せる用。「次に何をすればよいか」が分かる文にする） */
  requirement: string;
  /** 解放されているか */
  unlocked(ctx: UnlockContext): boolean;
  /** 0〜1。解放まであとどれくらいか（並べ替えと表示に使う） */
  progress(ctx: UnlockContext): number;
}>;

const ratio = (now: number, target: number): number =>
  target <= 0 ? 1 : Math.min(1, Math.max(0, now) / target);

const byRuns = (id: string, name: string, description: string, runs: number): UnlockEntry => ({
  id,
  name,
  description,
  requirement: `${runs} 回プレイする`,
  unlocked: ctx => ctx.runs >= runs,
  progress: ctx => ratio(ctx.runs, runs),
});

const byCodex = (id: string, name: string, description: string, found: number): UnlockEntry => ({
  id,
  name,
  description,
  requirement: `図鑑を ${found} 件見つける`,
  unlocked: ctx => ctx.codexFound >= found,
  progress: ctx => ratio(ctx.codexFound, found),
});

const byOfficialDays = (id: string, name: string, description: string, days: number): UnlockEntry => ({
  id,
  name,
  description,
  requirement: `日替わりの本番を ${days} 日ぶん済ませる`,
  unlocked: ctx => ctx.officialDays >= days,
  progress: ctx => ratio(ctx.officialDays, days),
});

export const UNLOCKS: readonly UnlockEntry[] = [
  byRuns('records', 'プレイの記録', '終わったプレイの記録を見返せる', 1),
  byCodex('codex', '図鑑', '見つけた天体と出来事のコレクション', 1),
  byRuns('replay', 'プレイの再生', '終わったプレイを最初から見直せる', 2),
  byRuns('daily', '日替わり勝負', 'その日の盤面での 1 日 1 回の本番', 3),
  byCodex('codex-hints', '図鑑の手がかり', 'まだ見つけていない項目の手がかりが見える', 5),
  byRuns('stats', '詳しい統計', '連鎖・到達 Tier・限界時間などの内訳', 5),
  {
    id: 'share',
    name: '結果の共有',
    description: 'プレイを短い文字列や 1 枚の画像にして人に渡せる',
    requirement: '1 プレイで 10,000 点を取る',
    unlocked: ctx => ctx.bestScore >= 10_000,
    progress: ctx => ratio(ctx.bestScore, 10_000),
  },
  byRuns('growth', '記録の移り変わり', '自分の記録が上手くなっていくのを見る', 10),
  byOfficialDays('daily-history', '日替わりの履歴', '昨日の自分・先週の自分と並べて見られる', 2),
  byOfficialDays('daily-regular', '日替わりの常連', '毎日の本番を欠かさない人の証', 7),
  byCodex('observatory', '天文台', '見つけた物が一堂に並ぶ、集めた人の場所', 15),
  byCodex('stargazer', '星の博士', '図鑑の大半を集めた。残りももう少し', 25),
];

export type LockedView = Readonly<{
  entry: UnlockEntry;
  /** 0〜1 */
  progress: number;
}>;

export type UnlockSummary = Readonly<{
  unlocked: readonly UnlockEntry[];
  /** 未解放を「あと少しで開く」順に並べた物 */
  locked: readonly LockedView[];
  unlockedCount: number;
  total: number;
}>;

/** いまの状態で全部の項目を評価する（純粋。ctx を変えない）。 */
export function evaluateUnlocks(ctx: UnlockContext): UnlockSummary {
  const unlocked: UnlockEntry[] = [];
  const locked: LockedView[] = [];
  for (const entry of UNLOCKS) {
    if (entry.unlocked(ctx)) unlocked.push(entry);
    else locked.push({ entry, progress: entry.progress(ctx) });
  }
  locked.sort((a, b) => b.progress - a.progress);
  return { unlocked, locked, unlockedCount: unlocked.length, total: UNLOCKS.length };
}
