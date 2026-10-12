import { TIER_COLOR } from '../game/constants';

export function readTheme(canvas: HTMLCanvasElement) {
  const style = getComputedStyle(canvas);
  return {
    bg: style.getPropertyValue('--bg').trim(),
    text: style.getPropertyValue('--text').trim() || TIER_COLOR[8],
    chain: style.getPropertyValue('--chain').trim() || TIER_COLOR[3],
    danger: style.getPropertyValue('--danger').trim() || TIER_COLOR[4],
    cool: style.getPropertyValue('--cool').trim() || TIER_COLOR[0],
    font: style.getPropertyValue('--font').trim() || style.fontFamily,
  };
}

export type EffectTheme = ReturnType<typeof readTheme>;
