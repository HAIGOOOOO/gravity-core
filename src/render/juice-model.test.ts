import { describe, expect, it } from 'vitest';
import { sampleEvent } from '../fixtures';
import { JUICE_LAYERS, JUICE_PEAK_LAYERS, juiceDuration, juiceEnvelope, makeJuiceBurst } from './juice-model';

describe('演出の出来事と時間',()=>{
  it('合体の情報を受け取り、同じ出来事は同じ姿になる',()=>{
    const event=sampleEvent('merge',4,160,-120,3);
    const a=makeJuiceBurst(event,'fracture')!;
    expect(makeJuiceBurst(event,'fracture')).toEqual(a);
    expect(a).toMatchObject({x:160,y:-120,tier:5,chain:3,score:event.scoreDelta});
    expect(makeJuiceBurst(sampleEvent('land'),'jet')).toBeNull();
    expect(juiceDuration(a)).toBeGreaterThan(1);
  });
  it('出る前と消えた後に残らず、頂点で最大になる',()=>{
    expect(juiceEnvelope(0,0.1,0.2,1)).toBe(0);
    expect(juiceEnvelope(0.2,0.1,0.2,1)).toBe(1);
    expect(juiceEnvelope(2,0.1,0.2,1)).toBe(0);
  });
  it('実装済みの20部品を個数で水増ししない',()=>{
    expect(new Set(JUICE_LAYERS).size).toBe(20);
    expect(new Set([...JUICE_LAYERS,...JUICE_PEAK_LAYERS]).size).toBe(24);
  });
});
