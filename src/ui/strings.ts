// 画面の文字はすべてここに集める（SPEC.md 6.8）。担当 D が管理する。
// 既にあるキーはアプリ（src/app/）が使っているので、名前を変えたり消したりしないこと。足すのは自由。

export const STRINGS = {
  title: 'GRAVITY CORE',
  tagline: '重力を読んで、同じ天体を融合させよう。',
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

  hintGuide: '印の位置から、矢印の向きにドラッグして離そう。',
  hintTapOnly: 'ドラッグして射出',
  hintPreview: '予測線は衝突を含みません',
  hintFateCore: 'この軌道は核へ落ちます',
  hintFateOutside: 'この軌道は場外へ出ます',
  hintTooFast: '速すぎる衝突。同じ向きに回すと融合しやすい',
  hintCoreFall: '横向きに撃つと軌道に乗ります',
  hintChain: '連鎖！生まれた天体がすぐ融合すると得点が増えます',
  hintOverheat: '核が過熱しています',

  heatAbsorb: '核へ落下',
  heatEscape: '軌道から流出',
  heatPurge: '過密',
} as const;

/** 「連鎖 ×3（2.0 倍）」 */
export function chainLabel(chain: number, multiplier: number): string {
  return `連鎖 ×${chain}（${multiplier.toFixed(1)} 倍）`;
}

/** 結果のコピー用の 1 行 */
export function resultText(score: number, tierName: string, maxChain: number): string {
  return `GRAVITY CORE スコア ${score.toLocaleString('ja-JP')}／最高 ${tierName}／最大連鎖 ${maxChain}`;
}
