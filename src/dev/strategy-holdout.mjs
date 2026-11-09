// 本番の物理をそのまま使い、調整時とは別のシードで単純な連投を検査する。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const seedStart = Number(process.argv[2] ?? 1101);
const count = Number(process.argv[3] ?? 32);
const experiment = process.argv[4] ?? 'production';
const suite = process.argv[5] ?? 'standard';
if (!['production', 'quick', 'cycle3', 'cycle5', 'cycle8'].includes(experiment)) throw new Error('実験名が不明です');
if (!['standard', 'tempo'].includes(suite) || !Number.isInteger(seedStart) || seedStart < 1 || !Number.isInteger(count) || count < 8 || count > 128) {
  throw new Error('使い方: node src/dev/strategy-holdout.mjs [開始シード] [8〜128シード] [production|quick|cycle3|cycle5|cycle8] [standard|tempo]');
}
const seeds = Array.from({ length: count }, (_, n) => seedStart + n);
const path = `docs/notes/C/strategy-${experiment}${suite === 'standard' ? '' : '-tempo'}-${seedStart}-${count}.json`;
const server = await createServer({
  configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom',
  plugins: !experiment.startsWith('cycle') ? [] : [{
    name: 'strategy-holdout-cycle',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/game/launch-heat.ts')) return;
      const anchor = 'return Math.max(0, Math.max(world, moving) - REPEAT_LAUNCH_FREE_PREVIOUS) * REPEAT_LAUNCH_HEAT_STEP;';
      if (!source.includes(anchor)) throw new Error('加熱の比較箇所が見つかりません');
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
  const { randomBot, spiralBot } = await server.ssrLoadModule('/src/tools/bots.ts');
  const { dropAt } = await server.ssrLoadModule('/src/fixtures/index.ts');
  const { LAUNCH_COOLDOWN, TICK_HZ } = await server.ssrLoadModule('/src/game/constants.ts');
  const fast = Math.round(LAUNCH_COOLDOWN * TICK_HZ), slow = TICK_HZ;
  const maxTicks = 5 * 60 * TICK_HZ;
  const four = (start, jitter = 0) => seed => {
    let shot = 0;
    const rng = createRng(seed + 701);
    return () => dropAt(start + (shot++ % 4) * Math.PI / 2 + (jitter ? (2 * rng() - 1) * jitter : 0));
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
  const cases = suite === 'tempo'
    ? tempo.flatMap(([suffix, spacing]) => [
      [`random${suffix}`, spacing, seed => randomBot(seed).decide],
      [`four${suffix}`, spacing, four(-Math.PI / 4)],
    ])
    : experiment === 'production' ? allCases : allCases.filter(([name]) =>
      ['random', 'spiral', 'four', 'four-offset', 'four-jitter'].includes(name)
      || experiment === 'cycle8' && ['random-slow', 'four-slow'].includes(name));
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
            nextShot = tick + (launched ? spacing : 12);
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
    const summary = { strategy, shotSpacingSeconds: spacing / TICK_HZ, score: median(runs.map(r => r.score)), seconds: median(runs.map(r => r.seconds)),
      heatFromShots: median(runs.map(r => r.heatFromShots)), timedOut: runs.filter(r => r.timedOut).length };
    report.summary.push(summary);
    console.log(JSON.stringify(summary));
    save();
  }
  // 同じ種の組を一緒に引き直し、中央値比の標本によるぶれを見る。
  for (const { strategy, runs } of report.runs) {
    const reference = suite === 'tempo' ? strategy.replace(/^four/, 'random') : strategy.endsWith('-slow') ? 'random-slow' : 'random';
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
