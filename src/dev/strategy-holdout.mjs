// 本番の物理をそのまま使い、調整時とは別のシードで単純な連投を検査する。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const seedStart = Number(process.argv[2] ?? 1101);
const count = Number(process.argv[3] ?? 32);
const experiment = process.argv[4] ?? 'production';
const suite = process.argv[5] ?? 'standard';
const cycle = /^cycle[358]$/.test(experiment);
const zones = /^zones(8|12)$/.test(experiment);
if (!(experiment === 'production' || experiment === 'quick' || cycle || zones)) throw new Error('実験名が不明です');
if (!['standard', 'tempo', 'aiming', 'evasion'].includes(suite) || !Number.isInteger(seedStart) || seedStart < 1 || !Number.isInteger(count) || count < 8 || count > 128) {
  throw new Error('使い方: node src/dev/strategy-holdout.mjs [開始シード] [8〜128シード] [実験名] [standard|tempo|aiming|evasion]');
}
const seeds = Array.from({ length: count }, (_, n) => seedStart + n);
const suiteSuffix = suite === 'standard' ? '' : `-${suite}`;
const path = `docs/notes/C/strategy-${experiment}${suiteSuffix}-${seedStart}-${count}.json`;
const server = await createServer({
  configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom',
  plugins: !cycle && !zones ? [] : [{
    name: 'strategy-holdout-cycle',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/game/launch-heat.ts')) return;
      const anchor = 'return Math.max(0, Math.max(world, moving) - REPEAT_LAUNCH_FREE_PREVIOUS) * REPEAT_LAUNCH_HEAT_STEP;';
      if (!source.includes(anchor)) throw new Error('加熱の比較箇所が見つかりません');
      if (zones) {
        const extra = Number(experiment.slice('zones'.length));
        return `import { repeatedFourZones } from '../dev/strategy-zone-heat';\n` + source.replace(anchor, `
          const fastRepeat = recent.length === 8 && tick - recent[0]!.tick <= Math.round(8 * 0.67 * TICK_HZ);
          const extra = fastRepeat && repeatedFourZones(recent, angle, REPEAT_LAUNCH_ANGLE) ? ${extra} : 0;
          return extra + Math.max(0, Math.max(world, moving) - REPEAT_LAUNCH_FREE_PREVIOUS) * REPEAT_LAUNCH_HEAT_STEP;
        `);
      }
      return source.replace(anchor, `
        const distance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a-b), Math.cos(a-b)));
        const period = 4;
        const older = recent.slice(-2 * period, -period), newer = recent.slice(-period);
        const cycle = older.length === period && near(newer[0]!.originAngleRadians)
          && newer.every((shot, i) => distance(shot.originAngleRadians, older[i]!.originAngleRadians) <= REPEAT_LAUNCH_ANGLE
            && newer.slice(0, i).every(other => distance(shot.originAngleRadians, other.originAngleRadians) > 2 * REPEAT_LAUNCH_ANGLE));
        const extra = cycle ? ${Number(experiment.slice(-1))} : 0;
        return extra + Math.max(0, Math.max(world, moving) - REPEAT_LAUNCH_FREE_PREVIOUS) * REPEAT_LAUNCH_HEAT_STEP;
      `);
    },
  }],
});

try {
  const { createSimulation } = await server.ssrLoadModule('/src/game/simulation.ts');
  const { createRng } = await server.ssrLoadModule('/src/game/rng.ts');
  const { randomBot, safeMergeBot, spiralBot } = await server.ssrLoadModule('/src/tools/bots.ts');
  const { dropAt } = await server.ssrLoadModule('/src/fixtures/index.ts');
  const { LAUNCH_COOLDOWN, TICK_HZ } = await server.ssrLoadModule('/src/game/constants.ts');
  const fast = Math.round(LAUNCH_COOLDOWN * TICK_HZ), slow = TICK_HZ;
  const maxTicks = 5 * 60 * TICK_HZ;
  const four = (start, jitter = 0, alternateOrder = false) => seed => {
    let shot = 0;
    const rng = createRng(seed + 701);
    return () => {
      const position = shot++ % 8;
      // 4方角を固定し、2周目だけ後半2投を入れ替える。8投で繰り返す。
      const direction = alternateOrder && position >= 6 ? 5 - position % 4 : position % 4;
      return dropAt(start + direction * Math.PI / 2 + (jitter ? (2 * rng() - 1) * jitter : 0));
    };
  };
  const fixed = () => () => dropAt(-Math.PI / 2);
  const allCases = [
    ['random', fast, seed => randomBot(seed).decide],
    ['spiral', fast, seed => spiralBot(seed).decide],
    ['fixed', fast, fixed],
    ['four', fast, four(-Math.PI / 2)],
    ['four-offset', fast, four(-Math.PI / 4)],
    ['four-jitter', fast, four(-Math.PI / 2, Math.PI / 90)],
    ['random-slow', slow, seed => randomBot(seed).decide],
    ['fixed-slow', slow, fixed],
    ['four-slow', slow, four(-Math.PI / 2)],
  ];
  const tempo = [['', fast], ['-medium', Math.round(.75 * TICK_HZ)], ['-slow', slow], ['-slower', Math.round(1.25 * TICK_HZ)]];
  const aimingCases = [
    ['random', fast, seed => randomBot(seed).decide],
    ['four', fast, four(-Math.PI / 4)],
    ['four-wobble', fast, four(-Math.PI / 4, Math.PI / 90)],
    ['four-mixed', fast, four(-Math.PI / 4, Math.PI / 90, true)],
    ['merge-safe', fast, seed => safeMergeBot(seed).decide],
  ];
  const evasionCases = [
    ...aimingCases,
    ['four-wide', fast, four(-Math.PI / 4, Math.PI / 18, true)],
    ['four-margin', fast + Math.round(.17 * TICK_HZ), four(-Math.PI / 4, Math.PI / 90, true)],
    ['random-margin', fast + Math.round(.17 * TICK_HZ), seed => randomBot(seed).decide],
  ];
  const cases = {
    tempo: tempo.flatMap(([suffix, spacing]) => [
      [`random${suffix}`, spacing, seed => randomBot(seed).decide],
      [`four${suffix}`, spacing, four(-Math.PI / 4)],
    ]),
    aiming: aimingCases,
    evasion: evasionCases,
    standard: experiment === 'production' ? allCases : allCases.filter(([name]) =>
      ['random', 'spiral', 'four', 'four-offset', 'four-jitter'].includes(name)
      || experiment === 'cycle8' && ['random-slow', 'four-slow'].includes(name)),
  }[suite];
  // 各戦法で別々に同じ乱数列を使い、受理された投数が同じなら次の間隔も同じ。
  const maxTimingJitter = suite === 'aiming' || suite === 'evasion' ? Math.round(.15 * TICK_HZ) : 0;
  const report = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    experiment, suite, seeds, maxSeconds: maxTicks / TICK_HZ, complete: false, summary: [], comparisons: [], runs: [],
  };
  const save = () => writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = sorted.length / 2;
    return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  for (const [strategy, spacing, createDecide] of cases) {
    const runs = [];
    for (const seed of seeds) {
      const sim = createSimulation(seed), decide = createDecide(seed);
      const timing = createRng(seed + 2603);
      let nextShot = 0, heatFromShots = 0, rejects = 0;
      for (let tick = 0; tick < maxTicks; tick++) {
        if (tick >= nextShot) {
          const snapshot = sim.getSnapshot();
          if (snapshot.phase === 'over') break;
          if (snapshot.launchCooldownLeftSeconds > 0) {
            nextShot = tick + Math.max(1, Math.ceil(snapshot.launchCooldownLeftSeconds * TICK_HZ));
          } else {
            const launched = sim.submitLaunch(decide(snapshot, c => sim.predict(c))).accepted;
            if (!launched) rejects++;
            const wait = launched && maxTimingJitter ? Math.floor(timing() * (maxTimingJitter + 1)) : 0;
            nextShot = tick + (launched ? spacing + wait : 12);
          }
        }
        const events = sim.stepFixed();
        for (const event of events) if (event.kind === 'launch') heatFromShots += event.heatDelta ?? 0;
        if (events.some(e => e.kind === 'gameOver')) break;
      }
      const s = sim.getSnapshot();
      runs.push({ seed, score: s.score, seconds: s.tick / TICK_HZ, heatFromShots, rejects,
        launches: s.stats.launches, bestTier: s.bestTierThisRun, timedOut: s.phase !== 'over' });
    }
    report.runs.push({ strategy, runs });
    const summary = { strategy, shotSpacingSeconds: spacing / TICK_HZ, maxTimingJitterSeconds: maxTimingJitter / TICK_HZ,
      score: median(runs.map(r => r.score)), seconds: median(runs.map(r => r.seconds)),
      heatFromShots: median(runs.map(r => r.heatFromShots)), timedOut: runs.filter(r => r.timedOut).length };
    report.summary.push(summary);
    console.log(JSON.stringify(summary));
    save();
  }
  // 同じ種の組を一緒に引き直し、中央値比の標本によるぶれを見る。
  for (const { strategy, runs } of report.runs) {
    const reference = suite === 'tempo' ? strategy.replace(/^four/, 'random')
      : strategy.endsWith('-slow') ? 'random-slow'
      : strategy.endsWith('-margin') ? 'random-margin' : 'random';
    if (reference === strategy) continue;
    const other = report.runs.find(row => row.strategy === reference).runs;
    const rng = createRng(23611), ratios = [];
    for (let n = 0; n < 2500; n++) {
      const chosen = seeds.map(() => Math.floor(rng() * seeds.length));
      ratios.push(median(chosen.map(i => runs[i].score)) / Math.max(1, median(chosen.map(i => other[i].score))));
    }
    ratios.sort((a, b) => a - b);
    report.comparisons.push({ strategy, reference,
      ratio: median(runs.map(r => r.score)) / Math.max(1, median(other.map(r => r.score))),
      pairedBootstrap95: [ratios[62], ratios[2437]],
      wins: runs.filter((r, i) => r.score > other[i].score).length,
      ties: runs.filter((r, i) => r.score === other[i].score).length,
    });
  }
  report.complete = true;
  save();
} finally {
  await server.close();
}
