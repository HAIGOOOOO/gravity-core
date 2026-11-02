import { TICK_HZ } from '../game/constants';

// 読み込みと再計算で同じ上限（1時間）を使う。
export const MAX_REPLAY_TICKS = TICK_HZ * 60 * 60;
