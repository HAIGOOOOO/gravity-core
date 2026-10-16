// 演出が頼む「時間の速さ」に上限をかける。ヒットストップやスローで遊びが止まりすぎないようにするため。
// 速さはゲームの計算（tick の進み）にだけ掛かる。演出そのものは実際の時間で動く。
import {
  HITSTOP_MAX_SECONDS,
  HITSTOP_RECOVER_SECONDS,
  SLOWMO_MAX_SECONDS,
  SLOWMO_MIN_SCALE,
  SLOWMO_RECOVER_SECONDS,
  TIME_STOP_BELOW,
} from '../game/constants';

export interface TimeGovernor {
  /** 頼まれた速さと、このフレームの実際の秒数から、使ってよい速さ（0〜1）を返す */
  apply(requested: number, realSeconds: number): number;
  reset(): void;
}

export function createTimeGovernor(): TimeGovernor {
  let stopped = 0; // 続けて止めている秒数
  let slowed = 0; // 続けて遅くしている秒数
  let recover = 0; // ふつうの速さに戻している残り秒数

  return {
    apply(requested, realSeconds) {
      if (recover > 0) {
        recover -= realSeconds;
        stopped = 0;
        slowed = 0;
        return 1;
      }
      const want = Number.isFinite(requested) ? Math.min(1, Math.max(0, requested)) : 1;
      if (want >= 1) {
        stopped = 0;
        slowed = 0;
        return 1;
      }
      if (want < TIME_STOP_BELOW) {
        stopped += realSeconds;
        if (stopped > HITSTOP_MAX_SECONDS) {
          recover = HITSTOP_RECOVER_SECONDS;
          stopped = 0;
          return 1;
        }
        return 0;
      }
      stopped = 0;
      slowed += realSeconds;
      if (slowed > SLOWMO_MAX_SECONDS) {
        recover = SLOWMO_RECOVER_SECONDS;
        slowed = 0;
        return 1;
      }
      return Math.max(SLOWMO_MIN_SCALE, want);
    },
    reset() {
      stopped = 0;
      slowed = 0;
      recover = 0;
    },
  };
}
