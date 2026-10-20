// Node専用の実験用入口。ゲームの型設定へNodeの型や依存を足さない。
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const label = process.argv[2] ?? 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('label');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const growth = label.startsWith('growth-');
  const module = await server.ssrLoadModule(growth ? '/src/dev/growth-bench.ts' : '/src/dev/rules-bench.ts');
  const report = growth ? module.runGrowthBench() : module.runRulesBench();
  writeFileSync(`docs/notes/C/rules-${label}.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(growth ? report : report.map(({ name, summary, runs }) => ({ name, score: summary.score.median, seconds: summary.seconds.median,
    timedOut: runs.filter((r) => r.timedOut).length, overflowNearGrowth: runs.reduce((s, r) => s + r.overflowNearGrowth, 0),
    cooling: runs.reduce((s, r) => s + r.cooling, 0) }))));
} finally {
  await server.close();
}
