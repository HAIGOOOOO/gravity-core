// 比較専用。候補の計算は一時ファイルへ分離し、本番へ採用する前に同じ入力方針で測る。
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';

const phase = process.argv[2] ?? 'screen';
const seeds = phase.startsWith('screen') ? [1,2,3,4] : Array.from({ length: 16 }, (_, i) => i + 101);
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const source = execFileSync('git', ['show', '02e0994:src/game/simulation.ts'], { encoding: 'utf8' }), generated = [];
const inject = (s, from, to) => { if (!s.includes(from)) throw new Error(`missing anchor ${from}`); return s.replace(from, to); };
const variants = {
  baseline: source,
  'heat-4': inject(source, '    stats.launches++;', `    stats.launches++;
    if (bestTier >= 3) {
      const hits = inputLog.slice(-8).filter(input => Math.abs(Math.atan2(Math.sin(input.originAngleRadians-command.originAngleRadians),Math.cos(input.originAngleRadians-command.originAngleRadians))) <= Math.PI / 12).length;
      heat = Math.min(HEAT_MAX, heat + hits * 4);
      if (heat >= HEAT_MAX) { over = true; emit({ kind: 'gameOver' }); }
    }`),
  'rotation-12': inject(source, '    // 6. 限界リングと熱量', `    const ca = Math.cos(Math.PI / 15 * DT), sa = Math.sin(Math.PI / 15 * DT);
    for (const b of bodies) if (b.landed) {
      const x = b.x, y = b.y, vx = b.vx, vy = b.vy;
      b.x = x * ca - y * sa; b.y = x * sa + y * ca; b.px = b.x; b.py = b.y;
      b.vx = vx * ca - vy * sa; b.vy = vx * sa + vy * ca;
    }
    // 6. 限界リングと熱量`),
  'damping-1-5': inject(source, 'const keep = 1 - CONTACT_DAMPING * DT;', 'const keep = 1 - 1.5 * DT;'),
};
variants['rotation-all-12'] = variants['rotation-12'].replace('for (const b of bodies) if (b.landed)', 'for (const b of bodies)');
variants['rotation-all-18'] = variants['rotation-all-12'].replaceAll('Math.PI / 15 * DT', 'Math.PI / 10 * DT');
const selected = phase === 'screen-all' ? ['baseline','rotation-all-12','rotation-all-18'] : phase === 'holdout' ? ['baseline','rotation-all-12'] : ['baseline','heat-4','rotation-12','damping-1-5'];
const median = values => { const a = [...values].sort((a,b)=>a-b); return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2; };
try {
  const { randomBot, spiralBot } = await server.ssrLoadModule('/src/tools/bots.ts');
  const { DROP_SPEED, TICK_HZ } = await server.ssrLoadModule('/src/game/constants.ts');
  const factories = {
    fixed: () => ({ decide: () => ({ originAngleRadians: -Math.PI/2, vx: 0, vy: DROP_SPEED }) }),
    four: () => { let shot=0; return { decide: () => { const a=-Math.PI/2+(shot++%4)*Math.PI/2; return { originAngleRadians:a,vx:-Math.cos(a)*DROP_SPEED,vy:-Math.sin(a)*DROP_SPEED }; } }; },
    random: randomBot, spiral: spiralBot,
  };
  const reports = [];
  for (const label of selected) {
    const variant = variants[label];
    const file = `src/game/simulation-${label}.dev.ts`; writeFileSync(file, variant); generated.push(file);
    const { createSimulation } = await server.ssrLoadModule(`/${file}`), runs=[];
    for (const [strategy, factory] of Object.entries(factories)) for (const seed of seeds) {
      const sim=createSimulation(seed), bot=factory(seed); let rejects=0;
      while (sim.getSnapshot().phase==='active' && sim.getSnapshot().tick < 5*60*TICK_HZ) {
        const s=sim.getSnapshot();
        if (s.launchCooldownLeftSeconds<=0) {
          const result=sim.submitLaunch(bot.decide(s,c=>sim.predict(c)));
          if (!result.accepted) { rejects++; for(let n=0;n<12 && sim.getSnapshot().phase==='active';n++) sim.stepFixed(); continue; }
        }
        sim.stepFixed();
      }
      const s=sim.getSnapshot(); runs.push({strategy,seed,score:s.score,seconds:s.tick/TICK_HZ,bestTier:s.bestTierThisRun,launches:s.stats.launches,rejects,timedOut:s.phase==='active'});
    }
    const summary=Object.keys(factories).map(strategy=>({strategy,score:median(runs.filter(r=>r.strategy===strategy).map(r=>r.score)),seconds:median(runs.filter(r=>r.strategy===strategy).map(r=>r.seconds)),timedOut:runs.filter(r=>r.strategy===strategy&&r.timedOut).length}));
    reports.push({label,seeds,summary,runs}); console.log(JSON.stringify({label,summary}));
    writeFileSync(`docs/notes/C/strategy-${phase}.json`,JSON.stringify(reports,null,2)+'\n');
  }
} finally { await server.close(); for(const file of generated) unlinkSync(file); }
