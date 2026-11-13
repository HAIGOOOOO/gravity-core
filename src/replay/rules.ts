import * as RULE_CONSTANTS from '../game/constants';

/** 保存形式の版。記録の形や入力の種類が増えたら上げる。 */
export const REPLAY_FORMAT = 3; // 3: 射出の値を丸める（2026-10-18）。丸める前の記録は再生しない

// ───────── ルールの版 ─────────
// constants.ts が export する値のうち、再生の正しさに関係しない物
// （見た目・音・照準の変換だけに使う数値）を除いた全部を JSON 化して FNV-1a で畳む。
// 新しい定数は既定で指紋に入る。入れ忘れて古い再生を「合う」と誤認する方が
// 危ないので、関係ない変化で古い再生が弾かれる分には許容する。
const NON_RULE_CONSTANTS: ReadonlySet<string> = new Set([
  'AIM_MIN_RADIUS',
  'DRAG_MIN_PX',
  'DRAG_MAX_PX',
  'PREDICT_SECONDS',
  'PREDICT_SAMPLE_SECONDS',
  'MAX_FRAME_SECONDS',
  'MAX_STEPS_PER_FRAME',
  'TRAIL_SECONDS',
  'TRAIL_POINTS',
  'PARTICLE_CAP',
  'FLOAT_TEXT_CAP',
  'GAMEOVER_SECONDS',
  'AUDIO_MAX_VOICES',
  'LAND_SOUND_WINDOW_SECONDS',
  'LAND_SOUND_MAX',
  'AUDIO_MASTER_GAIN',
  'DPR_CAP',
  'TIER_NAMES',
  'TIER_COLOR',
]);

let versionCache: string | null = null;

/** FNV-1a。同じ文字列なら必ず同じ 8 桁の指紋。 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * いまのルールの指紋。同じ数値なら必ず同じ文字列、1 つでも変われば変わる。
 * `r<形式>.<8桁のhash>` の形にする。
 */
export function rulesVersion(): string {
  if (versionCache) return versionCache;
  const values = RULE_CONSTANTS as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(values).sort()) {
    if (NON_RULE_CONSTANTS.has(key)) continue;
    parts.push(`${key}=${JSON.stringify(values[key])}`);
  }
  versionCache = `r${REPLAY_FORMAT}.${hashText(parts.join('|'))}`;
  return versionCache;
}
