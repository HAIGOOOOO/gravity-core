import type { BodyView, GameEvent, GameSnapshot, Prediction, SimulationPort, Tier } from '../contracts/game';
import { TIER_BASE_SCORE, TIER_RADIUS } from '../game/constants';
import { chainMultiplier, createSimulation } from '../game/simulation';
import { dropAt } from '../fixtures';
import type { JuiceBurst } from '../render/juice-model';
import { juiceMatterTime } from '../render/juice-timing';

export type JuiceScene = Readonly<{
  background: GameSnapshot;
  sources: readonly BodyView[];
  result: BodyView | undefined;
  event: GameEvent;
  prediction: Prediction;
  simulation: SimulationPort;
}>;

/** 合体そのものは実際の計算で作り、連鎖数だけ比較用に指定する。 */
export function createJuiceScene(tier: Tier, chain: number): JuiceScene {
  const radius = TIER_RADIUS[tier];
  const x = tier < 6 ? 135 : 0;
  const y = tier < 6 ? -100 : -230;
  const spectators = tier < 6
    ? [{ tier: 8 as const, x: 0, y: -260 }, { tier: 6 as const, x: -180, y: 80 }, { tier: 4 as const, x: 180, y: 120 }]
    : [{ tier: 0 as const, x: 230, y: 100 }, { tier: 4 as const, x: -210, y: 100 }];
  const sim = createSimulation(13, { bodies: [
    { tier, x: x - radius * .99, y }, { tier, x: x + radius * .99, y }, ...spectators,
  ], queue: [0, 1, 2] });
  let before = sim.getSnapshot();
  let actual: GameEvent | undefined;
  for (let tick = 0; tick < 120 && !actual; tick++) {
    before = sim.getSnapshot();
    actual = sim.stepFixed().find(e => e.kind === (tier === 8 ? 'supernova' : 'merge') && e.sourceTier === tier);
  }
  if (!actual) throw new Error('比較する合体が起きませんでした');
  const after = sim.getSnapshot();
  const sources = before.bodies.filter(b => actual!.bodyIds?.slice(0, 2).includes(b.id));
  const result = after.bodies.find(b => b.id === actual!.bodyIds?.[2]);
  const event = { ...actual, chain, scoreDelta: Math.round(TIER_BASE_SCORE[tier] * chainMultiplier(chain)) };
  // 参加する天体だけは演出の前面で描く。同じ天体を二重に描かないための表示用の抜き。
  const background = { ...after, bodies: after.bodies.filter(b => b.id !== result?.id) };
  return { background, sources, result, event, prediction: sim.predict(dropAt(-Math.PI / 2)), simulation: sim };
}

/** 見えている参加天体を一度だけ決め、描画・境界の遮蔽・期限表示で共有する。 */
export function juiceParticipants(scene:JuiceScene,burst:JuiceBurst,age:number,reduced:boolean):readonly BodyView[] {
  const time=reduced?.28:juiceMatterTime(burst,age)/(burst.direction==='echo'?1.6:burst.direction==='jet'?.82:1);
  if(time<.09){
    const p=Math.min(1,time/.09);
    return scene.sources.map(body=>({...body,x:body.x+(burst.x-body.x)*p*.55,y:body.y+(burst.y-body.y)*p*.55,radius:body.radius*(1-p*.18)}));
  }
  if(!scene.result)return [];
  const body=scene.result;
  return [{...body,radius:TIER_RADIUS[body.tier]*(time<.3?1+.12*Math.sin((time-.09)/.21*Math.PI):1)}];
}
