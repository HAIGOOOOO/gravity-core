// 熱量の状態（SPEC.md 5.1）。表示と演出の切り替えに使う。全担当が使ってよい。

import type { HeatState } from '../contracts/app';
import { HEAT_STATE_LIMITS } from '../game/constants';

export function heatState(heat: number): HeatState {
  if (heat >= HEAT_STATE_LIMITS[2]) return 'critical';
  if (heat >= HEAT_STATE_LIMITS[1]) return 'overheat';
  if (heat >= HEAT_STATE_LIMITS[0]) return 'rising';
  return 'stable';
}

export const HEAT_STATE_LABEL: Record<HeatState, string> = {
  stable: '安定',
  rising: '上昇',
  overheat: '過熱',
  critical: '臨界',
};

/** CSS 変数名（src/styles/tokens.css） */
export const HEAT_STATE_COLOR_VAR: Record<HeatState, string> = {
  stable: '--cool',
  rising: '--warn',
  overheat: '--overheat',
  critical: '--danger',
};

export const HEAT_STATE_COLOR: Record<HeatState, string> = {
  stable: '#83D9FF',
  rising: '#FFD66B',
  overheat: '#FFA978',
  critical: '#FF7D83',
};
