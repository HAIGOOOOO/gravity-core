import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const file='src/storage/history-baseline.dev.ts';
writeFileSync(file,execFileSync('git',['show','02e0994:src/storage/history.ts']));
try {
  const current=await server.ssrLoadModule('/src/storage/history.ts'), baseline=await server.ssrLoadModule('/'+file);
  const {summarizeTrend}=await server.ssrLoadModule('/src/storage/trend.ts');
  const runs=Array.from({length:1000},(_,n)=>({id:'r'+n,playedAt:new Date(Date.UTC(2024,0,1)+n*86400000).toISOString(),seed:n,gameVersion:'probe',score:n*10,seconds:100,launches:100,lands:100,merges:90,supernovas:0,maxChain:3,bestTier:6,overLimitSeconds:10,overLimitEntries:1,scorePerLaunch:n/10,maxSingleScore:100,maxImpactSpeed:200,mergesByTier:[90,0,0,0,0,0,0,0,0]}));
  const raw=JSON.stringify({version:1,runs}), samples={baseline:[],current:[]};
  for(let round=0;round<20;round++) for(const name of round%2?['current','baseline']:['baseline','current']) {
    const store=({baseline,current}[name]).createStatsStore({getItem:()=>raw,setItem(){},removeItem(){}});
    const started=performance.now(); summarizeTrend(store.load().runs,50); samples[name].push(performance.now()-started);
  }
  const report=Object.entries(samples).map(([name,ms])=>({name,samples:ms,median:[...ms].sort((a,b)=>a-b)[10],p95:[...ms].sort((a,b)=>a-b)[19]}));
  writeFileSync('docs/notes/C/history-performance-20261022.json',JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report.map(({samples,...r})=>r)));
} finally {await server.close();unlinkSync(file);}
