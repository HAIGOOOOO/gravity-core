// 比較専用。候補の計算は一時ファイルへ分離し、本番へ採用する前に同じ入力方針で測る。
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';

const phase = process.argv[2] ?? 'screen';
const seeds = phase.startsWith('screen') ? [1,2,3,4] : Array.from({ length: ['holdout30','stress30','holdout-pressure','stress-pressure'].includes(phase) ? 32 : 16 }, (_, i) => i + (phase === 'stress-pressure' ? 601 : phase === 'holdout-pressure' ? 501 : phase === 'stress30' ? 401 : phase === 'holdout30' ? 301 : phase === 'holdout18' ? 201 : 101));
const scratch = resolve('../work/strategy-variants');
mkdirSync(scratch, { recursive: true });
const server = await createServer({ server: { middlewareMode: true, fs: { allow: [process.cwd(), scratch] } }, appType: 'custom' });
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
variants['rotation-all-30'] = variants['rotation-all-12'].replaceAll('Math.PI / 15 * DT', 'Math.PI / 6 * DT');
variants['heat-05'] = variants['heat-4'].replace('heat + hits * 4', 'heat + hits * 0.5');
variants['heat-1'] = variants['heat-4'].replace('heat + hits * 4', 'heat + hits * 1');
variants['rotation30-pressure1'] = inject(variants['rotation-all-30'], '    stats.launches++;', `    stats.launches++;
    if (bestTier >= 3) {
      const recent = inputLog.slice(-8), angle = command.originAngleRadians;
      const near = a => Math.abs(Math.atan2(Math.sin(a-angle), Math.cos(a-angle))) <= Math.PI/12;
      const world = recent.filter(i => near(i.originAngleRadians)).length;
      const moving = recent.filter(i => near(i.originAngleRadians+Math.PI/6*(tick-i.tick)/TICK_HZ)).length;
      heat = Math.min(HEAT_MAX, heat + Math.max(0,Math.max(world,moving)-2));
      if (heat >= HEAT_MAX) { over = true; emit({ kind: 'gameOver' }); }
    }`);
variants['rotation30-pressure2'] = variants['rotation30-pressure1'].replace('Math.max(world,moving)-2)', 'Math.max(world,moving)-2)*2');
variants['rotation30-pressure3'] = variants['rotation30-pressure2'].replace('Math.max(world,moving)-2)', 'Math.max(world,moving)-1)');
variants['still-pressure2'] = variants['rotation30-pressure3']
  .replace(/    const ca = Math\.cos\(Math\.PI \/ 6 \* DT\),[\s\S]*?(?=    \/\/ 6\. 限界リングと熱量)/, '')
  .replace('i.originAngleRadians+Math.PI/6*(tick-i.tick)/TICK_HZ', 'i.originAngleRadians');
variants['still-pressure3'] = variants['still-pressure2'].replace('Math.max(world,moving)-1)*2', 'Math.max(world,moving)-1)*3');
variants['still-capped'] = variants['still-pressure3'].replace('Math.max(0,Math.max(world,moving)-1)*3', 'Math.min(10,Math.max(0,Math.max(world,moving)-1)*3)');
const groups = {
  'screen-capped': ['still-capped'],
  'screen-still': ['still-pressure2','still-pressure3'],
  'holdout-pressure': ['rotation30-pressure2'], 'screen-check': ['baseline','rotation-all-30'],
  'stress-pressure': ['rotation30-pressure3'],
  'screen-pressure': ['rotation-all-30','rotation30-pressure1','rotation30-pressure2'],
  'stress30': ['production-30'], 'holdout30': ['rotation-all-30'],
  'screen-refine': ['baseline','heat-05','heat-1','rotation-all-30'],
  'screen-all': ['baseline','rotation-all-12','rotation-all-18'],
  'holdout': ['baseline','rotation-all-12'], 'holdout18': ['baseline','rotation-all-18'],
};
const selected = groups[phase] ?? ['baseline','heat-4','rotation-12','damping-1-5'];
const median = values => { const a = [...values].sort((a,b)=>a-b); return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2; };
try {
  const { randomBot, spiralBot } = await server.ssrLoadModule('/src/tools/bots.ts');
  const { DROP_SPEED, LAUNCH_COOLDOWN, TICK_HZ } = await server.ssrLoadModule('/src/game/constants.ts');
  const { createRng } = await server.ssrLoadModule('/src/game/rng.ts');
  const factories = {
    fixed: () => ({ decide: () => ({ originAngleRadians: -Math.PI/2, vx: 0, vy: DROP_SPEED }) }),
    four: () => { let shot=0; return { decide: () => { const a=-Math.PI/2+(shot++%4)*Math.PI/2; return { originAngleRadians:a,vx:-Math.cos(a)*DROP_SPEED,vy:-Math.sin(a)*DROP_SPEED }; } }; },
    random: randomBot, spiral: spiralBot,
  };
  if (phase === 'screen-pressure' || phase === 'holdout-pressure') factories['fixed-with-flow'] = () => ({ decide: s => { const a=-Math.PI/2+s.tick/TICK_HZ*Math.PI/6; return { originAngleRadians:a,vx:-Math.cos(a)*DROP_SPEED,vy:-Math.sin(a)*DROP_SPEED }; } });
  if (phase === 'holdout-pressure') {
    factories['fixed-fast'] = () => ({ decide: () => ({originAngleRadians:-Math.PI/2,vx:0,vy:620}) });
    factories['random-fast'] = seed => { const rng=createRng(seed+101); return { decide: () => { const a=rng()*Math.PI*2; return {originAngleRadians:a,vx:-Math.cos(a)*620,vy:-Math.sin(a)*620}; } }; };
  }
  if (phase === 'stress30' || phase === 'stress-pressure') {
    const drop = (a, speed = DROP_SPEED) => ({ originAngleRadians:a, vx:-Math.cos(a)*speed, vy:-Math.sin(a)*speed });
    for (let n = 0; n < 4; n++) {
      const a = -Math.PI/2 + n*Math.PI/2;
      factories[`fixed-${n*90}`] = () => ({ decide: () => drop(a) });
      factories[`jitter-${n*90}`] = seed => { const rng=createRng(seed+701); return { decide: () => drop(a+(rng()*2-1)*Math.PI/90) }; };
    }
    delete factories.fixed;
    factories['fixed-slow'] = () => ({ spacingTicks: TICK_HZ, decide: () => drop(-Math.PI/2) });
    factories['random-slow'] = seed => ({ ...randomBot(seed), spacingTicks: TICK_HZ });
    factories['fixed-fast'] = () => ({ decide: () => drop(-Math.PI/2,620) });
    factories['random-fast'] = seed => { const rng=createRng(seed+101); return { decide: () => drop(rng()*Math.PI*2,620) }; };
    factories['fixed-with-flow'] = () => ({ decide: s => drop(-Math.PI/2+s.tick/TICK_HZ*Math.PI/6) });
  }
  const reports = [];
  for (const label of selected) {
    let modulePath = '/src/game/simulation.ts';
    if (!label.startsWith('production')) {
      const variant = variants[label].replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g, (_, a, path, b) => a + '/@fs/' + resolve('src/game', path + '.ts').replaceAll('\\', '/') + b);
      const file = resolve(scratch, `simulation-${label}.ts`); writeFileSync(file, variant); generated.push(file);
      modulePath = '/@fs/' + file.replaceAll('\\', '/');
    }
    const { createSimulation } = await server.ssrLoadModule(modulePath), runs=[];
    const report = {label,seeds,complete:false,plannedStrategies:Object.keys(factories),summary:[],runs}; reports.push(report);
    for (const [strategy, factory] of Object.entries(factories)) {
      for (const seed of seeds) {
      const sim=createSimulation(seed), bot=factory(seed); let rejects=0, nextLaunch=0;
      // 描画用の全コピーは射出を判断する時だけ取る。物理の刻みと入力は省略しない。
      for (let tick=0; tick<5*60*TICK_HZ; tick++) {
        if (tick>=nextLaunch) {
          const s=sim.getSnapshot();
          if (s.phase!=='active') break;
          if (s.launchCooldownLeftSeconds>0) { nextLaunch=tick+Math.max(1,Math.ceil(s.launchCooldownLeftSeconds*TICK_HZ)); }
          else {
          const result=sim.submitLaunch(bot.decide(s,c=>sim.predict(c)));
          if (!result.accepted) { rejects++; nextLaunch=tick+12; }
          else nextLaunch=tick+Math.max(Math.round(LAUNCH_COOLDOWN*TICK_HZ),bot.spacingTicks ?? 0);
          if (sim.getSnapshot().phase!=='active') break;
          }
        }
        if (sim.stepFixed().some(e=>e.kind==='gameOver')) break;
      }
      const s=sim.getSnapshot(); runs.push({strategy,seed,score:s.score,seconds:s.tick/TICK_HZ,bestTier:s.bestTierThisRun,launches:s.stats.launches,rejects,timedOut:s.phase==='active'});
      }
      report.summary.push({strategy,score:median(runs.filter(r=>r.strategy===strategy).map(r=>r.score)),seconds:median(runs.filter(r=>r.strategy===strategy).map(r=>r.seconds)),timedOut:runs.filter(r=>r.strategy===strategy&&r.timedOut).length});
      console.log(JSON.stringify({label,...report.summary.at(-1)}));
      writeFileSync(`docs/notes/C/strategy-${phase}.json`,JSON.stringify(reports,null,2)+'\n');
    }
    report.complete=true;
    writeFileSync(`docs/notes/C/strategy-${phase}.json`,JSON.stringify(reports,null,2)+'\n');
  }
} finally { await server.close(); for(const file of generated) unlinkSync(file); }
