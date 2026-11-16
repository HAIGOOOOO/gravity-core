import { describe, expect, it } from 'vitest';
import { repeatedFourAxes, repeatedFourZones } from './strategy-zone-heat';

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
  it('3投ずつの判定は順番が入れ替わっても4方角を数える', () => {
    const twelve = history([-4, 93, 181, 267, 3, 88, 272, 184, 91, 179, 269, 0]);
    expect(repeatedFourZones(twelve, radians(359), radians(24), 3)).toBe(true);
    expect(repeatedFourZones(twelve, radians(45), radians(24), 3)).toBe(false);
    expect(repeatedFourZones(twelve.slice(4), 0, radians(24), 3)).toBe(false);
  });
  it('たまたま4方角に各2投そろった合体狙いを3投ずつの試作では除外する', () => {
    // seed1708の合体狙い。次の195度が401投目。
    const aimed = history([37.5, 45, 60, 300, 15, 157.5, 322.5, 67.5, 345, 82.5, 90, 142.5, 202.5, 142.5, 337.5, 202.5]);
    expect(repeatedFourZones(aimed.slice(-8), radians(195), radians(24))).toBe(true);
    expect(repeatedFourZones(aimed.slice(-12), radians(195), radians(24), 3)).toBe(false);
    expect(repeatedFourAxes(aimed, radians(195))).toBe(false);
  });
});

it('直角に並ぶ4帯は、別の方角3投と円の端をまたぐぶれを許す', () => {
  const fourWithGaps = history([351, 90, 180, 270, 2, 97, 179, 274, 45, 88, 181, 275, 357, 135, 182, 225]);
  expect(repeatedFourAxes(fourWithGaps, radians(356))).toBe(true);
  expect(repeatedFourAxes(fourWithGaps, radians(45))).toBe(false);
  expect(repeatedFourAxes(fourWithGaps.slice(1), radians(356))).toBe(false);
  const uneven = history([0, 90, 180, 270, 0, 90, 180, 270, 0, 90, 180, 45, 0, 90, 180, 135]);
  expect(repeatedFourAxes(uneven, 0)).toBe(false);
});
