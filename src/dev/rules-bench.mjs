// Node専用の実験用入口。ゲームの型設定へNodeの型や依存を足さない。
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const label = process.argv[2] ?? 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('label');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let baselineFile = false;
try {
  const growth = label.startsWith('growth-');
  const module = await server.ssrLoadModule(growth ? '/src/dev/growth-bench.ts' : '/src/dev/rules-bench.ts');
  if (label === 'growth-critical-baseline') {
    writeFileSync('src/game/simulation-baseline.dev.ts', execFileSync('git', ['show', '7e555a7:src/game/simulation.ts']));
    baselineFile = true;
  }
  const baseline = baselineFile ? await server.ssrLoadModule('/src/game/simulation-baseline.dev.ts') : null;
  const report = growth ? module.runGrowthBench(baseline?.createSimulation, baseline?.restoreSimulation) : module.runRulesBench();
  writeFileSync(`docs/notes/C/rules-${label}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(growth ? { cases: report.length, lost: report.filter((r) => r.lost).length, peakOutward: Math.max(...report.map((r) => r.peakOutward)),
    overflowCases: report.filter((r) => r.outsideSeconds > 0).length } : report.map(({ name, summary, runs }) => ({ name, score: summary.score.median, seconds: summary.seconds.median,
    timedOut: runs.filter((r) => r.timedOut).length, overflowNearGrowth: runs.reduce((s, r) => s + r.overflowNearGrowth, 0),
    cooling: runs.reduce((s, r) => s + r.cooling, 0) }))));
} finally {
  await server.close();
  if (baselineFile) unlinkSync('src/game/simulation-baseline.dev.ts');
}
