import type { Tier } from '../contracts/game';
import { CORE_RADIUS, TIER_RADIUS } from '../game/constants';
import { createSimulation } from '../game/simulation';

/** 連鎖の値は指定しない。この配置から本物の接触と合体だけで5段まで進む。 */
export function createJuiceChain() {
  const at=(tier:Tier,distance:number,angle:number)=>({tier,x:Math.cos(angle)*distance,y:Math.sin(angle)*distance});
  const up=-Math.PI/2;
  return createSimulation(1,{bodies:[
    at(0,CORE_RADIUS+TIER_RADIUS[0],up),
    at(0,CORE_RADIUS+TIER_RADIUS[0]*3,up),
    ...([1,2,3,4] as const).map((tier,index)=>at(tier,CORE_RADIUS+TIER_RADIUS[tier]+35,up+(index%2?-1:1)*.55*(1+index*.25))),
  ]});
}
