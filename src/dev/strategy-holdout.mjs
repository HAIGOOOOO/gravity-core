// 本番の物理をそのまま使い、調整時とは別のシードで単純な連投を検査する。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const seedStart = Number(process.argv[2] ?? 1101);
const count = Number(process.argv[3] ?? 32);
const experiment = process.argv[4] ?? 'production';
const suite = process.argv[5] ?? 'standard';
const uncappedGrowth = experiment === 'uncapped-growth';
const fixedPressure = experiment === 'fixed-pressure2';
const cycle = /^cycle[358]$/.test(experiment);
const triple = experiment === 'zones-triple9';
const axesCarry = experiment === 'zones-axis9carry5';
const axesSustained = experiment === 'zones-axis24-sustained9';
const axes24 = experiment === 'zones-axis24-9' || axesSustained;
const axes = /^zones-axis(9|11)$/.test(experiment) || axesCarry || axes24;
const wide = triple || experiment === 'zones-wide9';
const zones = /^zones(8|10|12)$/.test(experiment) || wide || axes;
const extraHistory = axes24 ? 24 : axes ? 16 : triple ? 12 : null;
const heatVariant = cycle || zones || fixedPressure;
if (!(experiment === 'production' || experiment === 'quick' || heatVariant || uncappedGrowth)) throw new Error('実験名が不明です');
const variableTempoSuites = ['aiming', 'evasion', 'confirmation', 'interruptions', 'mixed-input'];
const tempoSuite = suite === 'tempo' || suite === 'tempo-fixed';
if (!(suite === 'standard' || tempoSuite || variableTempoSuites.includes(suite)) || !Number.isInteger(seedStart) || seedStart < 1 || !Number.isInteger(count) || count < 8 || count > 128) {
  throw new Error('使い方: node src/dev/strategy-holdout.mjs [開始シード] [8〜128シード] [実験名] [standard|tempo|tempo-fixed|aiming|evasion|confirmation|interruptions|mixed-input]');
}
const seeds = Array.from({ length: count }, (_, n) => seedStart + n);
const suiteSuffix = suite === 'standard' ? '' : `-${suite}`;
const path = `docs/notes/C/strategy-${experiment}${suiteSuffix}-${seedStart}-${count}.json`;
const server = await createServer({
  configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom',
  plugins: !heatVariant && !uncappedGrowth ? [] : [{
    name: 'strategy-holdout-variant',
    enforce: 'pre',
    transform(source, id) {
      const normalizedId = id.replaceAll('\\', '/');
      if (uncappedGrowth && normalizedId.endsWith('/src/game/simulation.ts')) {
        const correction = 'if (growth.has(b.id) && radial > 0) {';
        if (!source.includes(correction)) throw new Error('成長の外向き速度補正が見つかりません');
        return source.replace(correction, 'if (false) {');
      }
      if (extraHistory && normalizedId.endsWith('/src/game/simulation.ts')) {
        const history = 'recentLaunches: inputLog.slice(-REPEAT_LAUNCH_MEMORY)';
        if (!source.includes(history)) throw new Error('試作の加熱予測に渡す履歴が見つかりません');
        return source.replace(history, `recentLaunches: inputLog.slice(-${extraHistory})`);
      }
      if (!heatVariant || !normalizedId.endsWith('/src/game/launch-heat.ts')) return;
      const base = 'Math.max(0, Math.max(world, moving) - REPEAT_LAUNCH_FREE_PREVIOUS) * REPEAT_LAUNCH_HEAT_STEP';
      const anchor = `return ${base};`;
      if (!source.includes(anchor)) throw new Error('加熱の比較箇所が見つかりません');
      if (fixedPressure) return source.replace(anchor, `return ${base} + (world === REPEAT_LAUNCH_MEMORY ? 2 : 0);`);
      if (zones) {
        const extra = axesCarry || axes24 ? 9 : axes ? Number(experiment.slice('zones-axis'.length))
          : wide ? 9 : Number(experiment.slice('zones'.length));
        const tolerance = wide ? '24 * Math.PI / 180' : 'REPEAT_LAUNCH_ANGLE';
        const zoneHistory = extraHistory ? `inputs.slice(-${extraHistory})` : 'recent';
        const window = axesSustained ? "'sustained'" : extraHistory;
        const test = axes ? `repeatedFourAxes(${zoneHistory}, angle, ${window})`
          : `repeatedFourZones(${zoneHistory}, angle, ${tolerance}, ${triple ? 3 : 2})`;
        // 帯を外した一投は軽くし、過去の偏りが崩れた時点で追加熱を解く。
        const miss = axesCarry ? `repeatedFourAxes(${zoneHistory}) ? 5 : 0` : '0';
        // ＋10では間隔の境界をなくし、通常の冷却で投げる速さの差が出るか調べる。
        const paceCondition = wide || axes || extra === 10 ? 'true' : 'recent.length === 8 && tick - recent[0]!.tick <= Math.round(8 * 0.67 * TICK_HZ)';
        return `import { ${axes ? 'repeatedFourAxes' : 'repeatedFourZones'} } from '../dev/strategy-zone-heat';\n` + source.replace(anchor, `
          const fastRepeat = ${paceCondition};
          const extra = fastRepeat && ${test} ? ${extra} : ${miss};
          return extra + ${base};
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
        return extra + ${base};
      `);
    },
  }],
});

try {
  const { createSimulation } = await server.ssrLoadModule('/src/game/simulation.ts');
  const { createRng } = await server.ssrLoadModule('/src/game/rng.ts');
  const { randomBot, safeMergeBot, spiralBot, curveBot } = await server.ssrLoadModule('/src/tools/bots.ts');
  const { dropAt } = await server.ssrLoadModule('/src/fixtures/index.ts');
  const { LAUNCH_COOLDOWN, TICK_HZ } = await server.ssrLoadModule('/src/game/constants.ts');
  const { rulesVersion } = await server.ssrLoadModule('/src/replay/rules.ts');
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
  const fourStart = (jitter = 0, alternate = false) => seed => {
    const angle = ['confirmation', 'interruptions', 'mixed-input'].includes(suite) && seed % 2 !== 0 ? -Math.PI / 2 : -Math.PI / 4;
    return four(angle, jitter, alternate)(seed);
  };
  const withInterruptions = seed => {
    const decide = fourStart(Math.PI / 90, true)(seed);
    let shots = 0;
    return () => {
      const shot = decide();
      // 6投ごとに元の方角から45度外す。
      return ++shots % 6 === 0 ? dropAt(shot.originAngleRadians + Math.PI / 4) : shot;
    };
  };
  const clumped = seed => {
    const order = [0, 1, 1, 2, 3, 2, 0, 3];
    const start = seed % 2 === 0 ? -Math.PI / 4 : -Math.PI / 2;
    let shot = 0;
    return () => dropAt(start + order[shot++ % order.length] * Math.PI / 2);
  };
  const aimingCases = [
    ['random', fast, seed => randomBot(seed).decide],
    ['four', fast, fourStart()],
    ['four-wobble', fast, fourStart(Math.PI / 90)],
    ['four-mixed', fast, fourStart(Math.PI / 90, true)],
    ['merge-safe', fast, seed => safeMergeBot(seed).decide],
  ];
  const evasionCases = [
    ...aimingCases,
    ['four-wide', fast, fourStart(Math.PI / 18, true)],
    ['four-margin', fast + Math.round(.17 * TICK_HZ), fourStart(Math.PI / 90, true)],
    ['random-margin', fast + Math.round(.17 * TICK_HZ), seed => randomBot(seed).decide],
  ];
  const interruptionsCases = [...evasionCases, ['four-interrupted', fast, withInterruptions], ['four-clumped', fast, clumped]];
  const tempoCases = tempo.flatMap(([suffix, spacing]) => [
    [`random${suffix}`, spacing, seed => randomBot(seed).decide],
    [`four${suffix}`, spacing, four(-Math.PI / 4)],
    ...(suite === 'tempo-fixed' ? [[`fixed${suffix}`, spacing, fixed]] : []),
  ]);
  const cases = {
    tempo: tempoCases,
    'tempo-fixed': tempoCases,
    aiming: aimingCases,
    evasion: evasionCases,
    confirmation: evasionCases,
    interruptions: interruptionsCases,
    'mixed-input': [...interruptionsCases, ['fixed', fast, fixed], ['curve-aim', fast, seed => curveBot(seed).decide]],
    standard: experiment === 'production' || uncappedGrowth || fixedPressure ? allCases : allCases.filter(([name]) =>
      ['random', 'spiral', 'four', 'four-offset', 'four-jitter'].includes(name)
      || experiment === 'cycle8' && ['random-slow', 'four-slow'].includes(name)),
  }[suite];
  // 各戦法で別々に同じ乱数列を使い、受理された投数が同じなら次の間隔も同じ。
  const maxTimingJitter = variableTempoSuites.includes(suite) ? Math.round(.15 * TICK_HZ) : 0;
  const report = {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    rulesVersion: rulesVersion(), experiment, suite, seeds, maxSeconds: maxTicks / TICK_HZ, complete: false, summary: [], comparisons: [], runs: [],
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
      if (!Number.isFinite(s.heat) || !Number.isFinite(heatFromShots)) {
        throw new Error(`熱量が不正です（${experiment}・${strategy}・seed ${seed}）`);
      }
      runs.push({ seed, score: s.score, seconds: s.tick / TICK_HZ, heatFromShots, rejects,
        launches: s.stats.launches, bestTier: s.bestTierThisRun, timedOut: s.phase !== 'over', lossKind: s.loss?.kind ?? null });
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
    const reference = tempoSuite ? strategy.replace(/^(four|fixed)/, 'random')
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
