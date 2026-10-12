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
  sound: '効果音',
  pause: '一時停止',
  soundOn: '効果音を切る',
  soundOff: '効果音を入れる',
  observatory: '重力観測室',
  titleNote: 'ひとつ落とす。ふたつが出会う。小さな天体から、星を育てる。',
  howtoSteps: [
    '盤面を押して離すと、その方角から天体が落ちる。',
    '同じ天体が触れると合体。引っぱって離すと、曲げて投げられる。',
    '山が限界リングを越えると核熱量が上がる。100で終了。',
  ],
  volume: '音量',
  reducedMotion: '動きを減らす',
  deviceDefault: '端末に合わせる',
  on: '入',
  off: '切',
  aimGuide: '予測線',
  playerName: '名前',
  nameHelp: '12文字まで。空欄は PLAYER として記録します。',
  clearRecords: '記録を消す',
  confirmClear: 'この端末のランキングとベストスコアを消します。よろしいですか？',
  cancel: 'やめる',
  confirm: '確定する',
  bestTier: '最高 Tier',
  maxChain: '最大連鎖',
  playTime: 'プレイ時間',
  launches: '射出数',
  merges: '合体数',
  resultReason: '積もった山が限界リングを越え、核熱量が100に達しました。',
  rankingNote: 'この端末の上位10件',
  emptyRanking: 'まだ記録がありません。最初の記録を作ろう。',
  backToGame: 'ゲームへ戻る',
  startGame: 'ゲームをはじめる',
  rank: '順位',
  date: '日付',
  latestRecord: '直前のプレイ',

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

export function rankLabel(rank: number): string { return `この端末で ${rank} 位`; }

/** 「連鎖 ×3（2.0 倍）」 */
export function chainLabel(chain: number, multiplier: number): string {
  return `連鎖 ×${chain}（${multiplier.toFixed(1)} 倍）`;
}

/** 結果のコピー用の 1 行 */
export function resultText(score: number, tierName: string, maxChain: number): string {
  return `GRAVITY CORE スコア ${score.toLocaleString('ja-JP')}／最高 ${tierName}／最大連鎖 ${maxChain}`;
}
