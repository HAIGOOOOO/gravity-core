import { describe, expect, it } from 'vitest';
import { repeatedFourZones } from './strategy-zone-heat';

const radians = (degrees: number) => degrees * Math.PI / 180;
const near = radians(15);
const history = (angles: number[]) => angles.map((angle, tick) => ({ tick, originAngleRadians: radians(angle) }));

describe('4方角の試作判定', () => {
  const four = history([-4, 92, 179, 268, 3, 87, 273, 184]);
  it('順番を入れ替えても、円の端をまたぐ同じ方角を数える', () => {
    expect(repeatedFourZones(four, radians(359), near)).toBe(true);
    expect(repeatedFourZones(four, radians(-2), near)).toBe(true);
    expect(repeatedFourZones(four, radians(282), near)).toBe(true);
  });
  it('新しい方角、記録不足、ある方角に2投そろわない場合は加熱対象にしない', () => {
    expect(repeatedFourZones(four, radians(45), near)).toBe(false);
    expect(repeatedFourZones(four.slice(1), 0, near)).toBe(false);
    expect(repeatedFourZones(history([0, 0, 0, 90, 90, 180, 270, 270]), 0, near)).toBe(false);
    expect(repeatedFourZones(history([0, 2, 20, 22, 180, 182, 270, 272]), 0, near)).toBe(false);
  });
});
