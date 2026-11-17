import { describe, expect, it } from 'vitest';
import { grainPose, grainResolution } from './grain-detail';
import { TIER_COLOR } from '../game/constants';
import { contrastRatio } from './look-palette';

describe('小粒子の見た目', () => {
  it('本番の暗い背景と小粒子の面が3以上の明るさ比になる', () => {
    expect(contrastRatio(TIER_COLOR[0],'#070b18')).toBeGreaterThanOrEqual(3);
  });
  it('同じIDの姿を保ち、80体の向きは重複しない', () => {
    const poses = Array.from({ length: 80 }, (_,id) => grainPose(id));
    expect(grainPose(17)).toEqual(grainPose(17));
    expect(new Set(poses.map(pose => pose.angle)).size).toBe(80);
    expect(new Set(poses.map(pose => pose.variation)).size).toBe(3);
    expect(poses.every(pose => pose.angle >= 0 && pose.angle < Math.PI * 2)).toBe(true);
  });
  it('同じ半径でも実際のピクセル密度に合わせ、20の境で大きく飛ばない', () => {
    expect(grainResolution(14,1)).toBe(32);
    expect(grainResolution(14,2)).toBe(64);
    expect(grainResolution(14,3)).toBe(128);
    expect(grainResolution(19.9,2)).toBe(grainResolution(20.1,2));
    expect(grainResolution(200,4)).toBe(1024);
  });
});
