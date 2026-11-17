import { describe, expect, it } from 'vitest';
import { LIMIT_RADIUS } from '../game/constants';
import { limitIntersections } from './juice-guides';

describe('天体と境界の交点', () => {
  it('印は限界リングと天体の両方の外形にある', () => {
    for(const [x,y,radius] of [[0,-260,100],[315,20,25],[-310,-10,66]]){
      const points=limitIntersections(x!,y!,radius!);
      expect(points).toHaveLength(2);
      for(const point of points){
        expect(Math.hypot(point.x,point.y)).toBeCloseTo(LIMIT_RADIUS,8);
        expect(Math.hypot(point.x-x!,point.y-y!)).toBeCloseTo(radius!,8);
      }
    }
  });
  it('接点を二重にせず、完全に内側・外側・中心の場合に架空の印を出さない', () => {
    expect(limitIntersections(LIMIT_RADIUS+25,0,25)).toHaveLength(1);
    expect(limitIntersections(0,0,100)).toEqual([]);
    expect(limitIntersections(200,0,25)).toEqual([]);
    expect(limitIntersections(400,0,25)).toEqual([]);
  });
});
