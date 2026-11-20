// ブラウザーを操作せず、同じ物理の照準計算だけを測るNode用入口。
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { createSimulation } = await server.ssrLoadModule('/src/game/simulation.ts');
  const setup = { bestTier: 6, queue: [4, 0, 0], heat: 80, bodies: [
    { tier: 4, x: 82, y: -41 }, { tier: 3, x: 155, y: 0 }, { tier: 6, x: 253, y: 0 },
  ] };
  const fixture = createSimulation(31, setup);
  const candidates = [];
  for (const vx of [100, 150, 200, 250, 300]) for (const vy of [-200, -300, -400, -500]) {
    const command = { originAngleRadians: Math.PI / 2, vx, vy };
    const prediction = fixture.predict(command);
    if (prediction.mergePreview?.mayCrossLimit) candidates.push({ command, preview: prediction.mergePreview });
  }
  const performanceCases = [1, 40, 80].map((count) => {
    const bodies = Array.from({ length: count }, (_, i) => ({ tier: 0, x: Math.cos(i * Math.PI * 2 / count) * 180, y: Math.sin(i * Math.PI * 2 / count) * 180 }));
    const sim = createSimulation(31, { bodies, queue: [0, 0, 0] });
    const command = { originAngleRadians: 0, vx: -260, vy: 0 }, samples = [];
    for (let i = 0; i < 440; i++) { const start = performance.now(); sim.predict(command); if (i >= 40) samples.push(performance.now() - start); }
    samples.sort((a, b) => a - b);
    return { bodies: count, samples: samples.length, p95: samples[Math.floor(samples.length * 0.95)], max: samples.at(-1) };
  });
  const report = { candidates, performanceCases, scope: '静止した円の照準計算。80体は重なる合成配置で、ブラウザー全体のフレーム計測ではない。' };
  writeFileSync('docs/notes/C/prediction-20261022.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await server.close(); }
