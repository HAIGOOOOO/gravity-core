import type { Tier } from '../contracts/game';

export const GRID = 64;
export const CLIP_SECONDS = 3;
export const DOT_COLORS = ['#ff5a3c', '#ff8a45', '#ffb35c', '#ffd88a', '#fff1d0', '#f2f4ff', '#cfdcff', '#a9c2ff', '#8fb0ff'] as const;
export const FIRST_FRAME = .96;
export type ClipName = 'merge' | 'chain' | 'nova';
export type MotionChoice = 'flow' | 'flip' | 'field';
export type Point = Readonly<{ x: number; y: number }>;
export type DotBody = Point & Readonly<{ tier: Tier }>;

const initial: readonly DotBody[] = [
  { x: 34, y: 14, tier: 0 },
  { x: 48, y: 17, tier: 0 },
  { x: 53, y: 31, tier: 1 },
  { x: 49, y: 46, tier: 2 },
  { x: 29, y: 51, tier: 3 },
  { x: 14, y: 43, tier: 4 },
];
const novaPair = [{ x: 35, y: 13, tier: 8 }, { x: 51, y: 18, tier: 8 }] as const;
const timings = { merge: [.82], chain: [.38, .81, 1.24, 1.67, 2.10], nova: [.96] } as const;
const chainPoints = [100, 330, 770, 1500, 2700];
const APPROACH_SECONDS = .16;

export const unit = (n: number): number => Math.max(0, Math.min(1, n));
export const ease = (n: number): number => 1 - (1 - unit(n)) ** 3;
export const between = (a: number, b: number, n: number): number => a + (b - a) * n;
export const bodyRadius = (tier: Tier): number => 3.25 + tier * .52;

export function mixPoint(a: Point, b: Point, n: number): Point {
  return { x: between(a.x, b.x, n), y: between(a.y, b.y, n) };
}

export type MotionEvent = Readonly<{
  from: DotBody;
  trailFrom: Point;
  into: DotBody;
  result: DotBody;
  phase: number;
  stage: number;
  nova: boolean;
}>;

/** 見比べる3案に同じ天体・出来事・熱を渡す。時刻の前後どちらへ移動しても盤面を再現する。 */
export function sampleDotsMotion(clip: ClipName, seconds: number, reduced = false) {
  const isNova = clip === 'nova';
  const bodies = isNova ? [...novaPair, ...initial.slice(2)] : initial;
  const duration = isNova ? .60 : .25;
  let into: DotBody | undefined = bodies[0], consumed = 0, points = 18420, heat = isNova ? 86 : 62;
  let event: MotionEvent | null = null;
  let approaching: DotBody | undefined;
  for (const [index, start] of timings[clip].entries()) {
    if (!into) break;
    const source = bodies[index + 1]!;
    const result: DotBody = { ...mixPoint(into, source, .38), tier: Math.min(8, into.tier + 1) as Tier };
    const progress = reduced ? 0 : unit(1 + (seconds - start) / APPROACH_SECONDS);
    const from = { ...mixPoint(source, result, .22 * progress), tier: source.tier };
    if (seconds < start) { approaching = from; break; }
    const phase = unit((seconds - start) / duration);
    // 接触までは元の得点と熱。接触後に同じ差分をすべての案へ出す。
    if (phase >= .5) {
      points += isNova ? 45000 : chainPoints[index]!;
      heat -= isNova ? 40 : [2, 5, 8, 11, 14][index]!;
    }
    consumed++;
    if (phase < 1) {
      event = { from, trailFrom: source, into, result, phase, stage: index + 1, nova: isNova };
      break;
    }
    into = isNova ? undefined : result;
  }
  const visible = bodies.slice(consumed + 1);
  if (approaching) visible[0] = approaching;
  if (into && !event) visible.push(into);
  return { bodies: visible, event, points, heat };
}
