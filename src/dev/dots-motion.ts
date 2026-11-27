import type { BodyView, GameEvent } from '../contracts/game';
import { CORE_RADIUS, DT, LAUNCH_RADIUS, TIER_RADIUS } from '../game/constants';
import { createSimulation } from '../game/simulation';
import { createTimeGovernor } from '../shared/time';

const LOOP_SECONDS = 6;
const UP = -Math.PI / 2;

function at(tier: 0 | 1 | 2 | 4 | 6, distance: number, angle: number) {
  return { tier, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
}

/** 6体の同じ配置を使い、3段とも実際の合体イベントから表示する。 */
export function createDotsSimulation() {
  return createSimulation(1, {
    heat: 38,
    bodies: [
      at(0, CORE_RADIUS + TIER_RADIUS[0], UP),
      at(0, Math.min(LAUNCH_RADIUS, 120), UP),
      at(1, CORE_RADIUS + TIER_RADIUS[1], UP - 1.2),
      at(2, CORE_RADIUS + TIER_RADIUS[2], UP + 1.5),
      at(4, 300, .4),
      at(6, 320, 2.8),
    ],
  });
}

export type DotsImpact = { event: GameEvent; age: number };

/** 大きい段ほど停止とスローを伸ばす。上限は共通のTimeGovernorにも通す。 */
export function dotsTimeScale(age: number, chain: number, reduced: boolean): number {
  if (reduced || !Number.isFinite(age)) return 1;
  const stop = .025 + Math.min(3, chain) * .02;
  const slow = .12 + Math.min(3, chain) * .1;
  if (age < stop) return 0;
  if (age < stop + slow) return Math.max(.3, .8 - chain * .16);
  return 1;
}

export function interpolateDotsBodies(
  before: readonly BodyView[],
  current: readonly BodyView[],
  alpha: number,
): readonly BodyView[] {
  const byId = new Map(before.map(body => [body.id, body]));
  return current.map(body => {
    const previous = byId.get(body.id);
    if (!previous) return body;
    return {
      ...body,
      x: previous.x + (body.x - previous.x) * alpha,
      y: previous.y + (body.y - previous.y) * alpha,
    };
  });
}

export function createDotsPlayback() {
  let simulation = createDotsSimulation();
  let current = simulation.getSnapshot();
  let previous = current;
  let accumulator = 0;
  let elapsed = 0;
  let cycle = 1;
  let impacts: DotsImpact[] = [];
  const governor = createTimeGovernor();

  function reset(): void {
    simulation = createDotsSimulation();
    current = simulation.getSnapshot();
    previous = current;
    accumulator = 0;
    elapsed = 0;
    impacts = [];
    governor.reset();
  }

  return {
    reset,
    update(seconds: number, reduced: boolean) {
      elapsed += seconds;
      if (elapsed >= LOOP_SECONDS) {
        reset();
        cycle += 1;
      }
      impacts.forEach(impact => { impact.age += seconds; });
      impacts = impacts.filter(impact => impact.age < 1.15);
      const latest = impacts.at(-1);
      const requested = latest ? dotsTimeScale(latest.age, latest.event.chain ?? 1, reduced) : 1;
      accumulator += seconds * governor.apply(requested, seconds);
      while (accumulator >= DT) {
        previous = current;
        const events = simulation.stepFixed();
        current = simulation.getSnapshot();
        accumulator -= DT;
        const merges = events.filter(event => event.kind === 'merge');
        if (merges.length) {
          impacts.push(...merges.map(event => ({ event, age: 0 })));
          // 次の合体を同じ描画コマに潰さず、実イベントの反応に一度止まる。
          accumulator = 0;
          break;
        }
      }
      return {
        snapshot: current,
        bodies: interpolateDotsBodies(previous.bodies, current.bodies, accumulator / DT),
        impacts: impacts.map(impact => ({ ...impact })),
        elapsed,
        cycle,
      };
    },
  };
}
