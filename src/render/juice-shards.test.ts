import { describe, expect, it } from 'vitest';
import { sampleEvent } from '../fixtures';
import { makeJuiceBurst } from './juice-model';
import { juiceShards } from './juice-shards';
import { juiceExposure } from './juice-peak';

describe('殻の面と光', () => {
  const event = sampleEvent('merge',2,135,-100,5);
  it('面と陰面が同じ出来事・時刻・seedから同じ場所を使う', () => {
    const burst = makeJuiceBurst(event,'fracture')!;
    expect(juiceShards(burst,.28)).toEqual(juiceShards(burst,.28));
    expect(juiceShards(makeJuiceBurst(event,'fracture',1)!,.28)).not.toEqual(juiceShards(burst,.28));
  });
  it('噴流の殻を接線の両方向に絞り、初期から有限の大きさを保つ', () => {
    const burst = makeJuiceBurst(event,'jet')!;
    const axis = Math.atan2(burst.y,burst.x)+Math.PI/2;
    for(const time of [0,.1,.28,1]){
      for(const piece of juiceShards(burst,time)){
        expect([piece.x,piece.y,piece.size,piece.angle].every(Number.isFinite)).toBe(true);
        if(time===0)continue;
        const tangent=Math.cos(axis)*piece.x+Math.sin(axis)*piece.y;
        const across=-Math.sin(axis)*piece.x+Math.cos(axis)*piece.y;
        expect(Math.abs(across)).toBeLessThan(Math.abs(tangent)*.29);
      }
    }
  });
  it('強い感光を一つの短い区間にし、小さい合体と減らす設定には出さない', () => {
    const burst=makeJuiceBurst(event,'fracture')!;
    const small=makeJuiceBurst(sampleEvent('merge',0,135,-100,1),'fracture')!;
    let intervals=0,lit=false,total=0;
    for(let i=0;i<2000;i++){
      const active=juiceExposure(burst,i/1000,false)>0;
      if(active&&!lit)intervals++;
      if(active)total+=.001;
      lit=active;
      expect(juiceExposure(small,i/1000,false)).toBe(0);
      expect(juiceExposure(burst,i/1000,true)).toBe(0);
    }
    expect(intervals).toBe(1);expect(total).toBeLessThan(.05);
  });
});
