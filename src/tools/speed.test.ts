// 道具の速さを測る。遅いと 100 回まわしが実用にならないので、
// 「実際のゲームの 2 倍より速い」（TICK_HZ × 2 tick/秒）を最低ラインにした。
// 実測はこの 20 倍ほど速い。極端に遅くなった時だけ気づくための網。
// 測った数字は console.log に出す（node の型が無いので fs には書けない）。

import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '../game/constants';
import { playOnce } from './batch';
import { ALL_BOTS } from './bots';

/** 測る長さ: ゲーム内 30 秒ぶん */
const GAME_TICKS = 30 * TICK_HZ;
const MIN_TICKS_PER_SEC = TICK_HZ * 2;

describe('速さ', () => {
  for (const make of ALL_BOTS) {
    const name = make(0).name;
    it(
      `「${name}」はゲームの 2 倍より速くまわせる`,
      () => {
        const start = Date.now();
        const { result } = playOnce(make(3), { seed: 3, maxTicks: GAME_TICKS });
        const wallMs = Math.max(1, Date.now() - start);
        const perSec = (result.ticks / wallMs) * 1000;
        const perLaunch = result.launches > 0 ? wallMs / result.launches : 0;
        console.log(
          `  ${name}: ${result.ticks} tick / ${wallMs}ms = ${Math.round(perSec)} tick/s` +
            `（射出 ${result.launches} 回、1 回あたり ${perLaunch.toFixed(1)}ms）`,
        );
        expect(perSec).toBeGreaterThan(MIN_TICKS_PER_SEC);
      },
      60_000,
    );
  }
});
