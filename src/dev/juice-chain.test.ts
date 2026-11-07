import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '../game/constants';
import { createJuiceChain } from './juice-chain';

function play() {
  const simulation=createJuiceChain();
  const events=[];
  for(let tick=0;tick<TICK_HZ*6;tick++)events.push(...simulation.stepFixed().filter(e=>e.kind==='merge'));
  return {events,snapshot:simulation.getSnapshot()};
}

describe('連続合体の見本',()=>{
  it('実際の消費・誕生のIDが5回つながり、実得点と一致する',()=>{
    const {events,snapshot}=play();
    expect(events.map(e=>e.chain)).toEqual([1,2,3,4,5]);
    for(let index=1;index<events.length;index++)expect(events[index]!.bodyIds!.slice(0,2)).toContain(events[index-1]!.bodyIds![2]);
    expect(snapshot.score).toBe(events.reduce((total,e)=>total+e.scoreDelta!,0));
    expect(snapshot.stats.maxChain).toBe(5);
    expect(snapshot.bodies.map(body=>body.id)).toEqual([events[4]!.bodyIds![2]]);
  });
  it('再生しても同じtickと場所で起きる',()=>expect(play()).toEqual(play()));
});
