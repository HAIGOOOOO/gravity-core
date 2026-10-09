// 画面の文字はすべてここに集める。担当 D が管理する。
// 既にあるキーはアプリ（src/app/）が使っているので、名前を変えたり消したりしないこと。足すのは自由。

export const STRINGS = {
  title: 'GRAVITY CORE',
  tagline: '核のまわりに天体を積み、同じ天体を合体させよう。',
  start: 'はじめる',
  howto: '遊び方',
  ranking: 'ランキング',
  settings: '設定',
  close: '閉じる',
  resume: 'つづける',
  restart: '最初から',
  retry: 'もう一度',
  backToTitle: 'タイトルへ',
  seeRanking: 'ランキングを見る',
  copyResult: '結果をコピー',
  paused: '一時停止中',
  gameOver: '核が限界に達した',
  bestUpdated: 'ベスト更新！',
  confirmDiscard: 'このプレイは記録されません。よろしいですか？',

  score: 'スコア',
  best: 'ベスト',
  heat: '核熱量',
  next: '次の天体',

  hintStart: '盤面を押すと、その方角から玉が落ちる。同じ玉に当てて合体させよう。',
  hintThrow: '押したまま横に引っぱると、曲げて投げられます',
  hintChain: '連鎖！生まれた天体がすぐ合体すると得点が増えます',
  hintLimit: '山が限界リングを越えています。越えている間、核の熱量が上がります',
  hintOverheat: '核が過熱しています',

  // 盤面の上に出る演出の文字（担当 C が使う）
  effectChain: '連鎖',
  effectSupernova: '超新星反応',
  effectHeat: '核熱量',
} as const;

/** 「連鎖 ×3（2.0 倍）」 */
export function chainLabel(chain: number, multiplier: number): string {
  return `連鎖 ×${chain}（${multiplier.toFixed(1)} 倍）`;
}

/** 結果のコピー用の 1 行 */
export function resultText(score: number, tierName: string, maxChain: number): string {
  return `GRAVITY CORE スコア ${score.toLocaleString('ja-JP')}／最高 ${tierName}／最大連鎖 ${maxChain}`;
}
