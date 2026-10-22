import type { AimView } from '../contracts/app';
import type { GameEvent, GameSnapshot } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer } from '../effects';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { createSimulation, restoreSimulation, type Simulation } from '../game/simulation';
import { DT, HEAT_COOL_PER_SECOND, TIER_RADIUS } from '../game/constants';
import { setupTwoChain } from '../fixtures/chains';
import { setupInterventionPractice } from '../fixtures/intervention';
import { GROWTH_PREVIEW_COMMAND, setupGrowthPreview } from '../fixtures/growth-preview';

const board = document.querySelector<HTMLCanvasElement>('#board')!;
const canvas = document.querySelector<HTMLCanvasElement>('#effects')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const renderer = createBoardRenderer(board), effects = createEffectsLayer(canvas, stage), audio = createAudioManager();
const sound = document.querySelector<HTMLInputElement>('#sound')!;
const list = document.querySelector<HTMLOListElement>('#events')!;
let sim: Simulation = createSimulation(21), prev = sim.getSnapshot(), curr = prev;
let aim: AimView | null = null, running = false, bank = 0, last = performance.now(), time = 0;
let freePlay = false;
let stopAfterMerge = false, effectTail = 0;
let startHeat = 80, mergeCooling = 0, interventionCooling = 0, passiveChange = 0;
let growthReady = false, profileActive = false;
let paintSamples: number[] = [], intervalSamples: number[] = [], profileBodies = 0;

function unlock(): void {
  if (sound.checked) { audio.unlock(); audio.setSettings({ sfx: true, volume: 65 }); audio.resume(); }
}
const input = createPointerInput(board, {
  getSnapshot: () => sim.getSnapshot(), predict: (command) => sim.predict(command), onAim: (value) => { aim = value; },
  onLaunch: (command) => { unlock(); sim.submitLaunch(command); },
});
function append(events: readonly GameEvent[], snapshot: GameSnapshot): void {
  const delta = events.reduce((sum, e) => sum + ((e.kind === 'merge' || e.kind === 'supernova') ? e.heatDelta ?? 0 : 0), 0);
  mergeCooling -= delta;
  const cooling = snapshot.intervention?.coolingThisTick ?? 0;
  interventionCooling += cooling;
  passiveChange += snapshot.heat - prev.heat - delta + cooling;
  effects.handleEvents(events, snapshot);
  if (sound.checked) audio.handleEvents(events, snapshot);
  for (const e of events) {
    if (e.kind !== 'merge' && e.kind !== 'supernova' && e.kind !== 'gameOver' && e.kind !== 'collapse') continue;
    const li = document.createElement('li');
    li.textContent = e.kind === 'gameOver' ? '熱量100で終了' : e.kind === 'collapse' ? '射出後の一手: 崩壊を使用' : `${e.chain}連鎖 / 熱量${Number((e.heatDelta ?? 0).toFixed(1))} / +${e.scoreDelta}点`;
    list.prepend(li); if (list.children.length > 8) list.lastElementChild!.remove();
    if (stopAfterMerge && (e.kind === 'merge' || e.kind === 'supernova')) {
      running = false; stopAfterMerge = false; effectTail = 0.28;
      document.querySelector('#pause')!.textContent = '自然冷却を続ける';
    }
  }
}
function begin(chain?: number, tutorial: boolean | 'collapse' | 'growth' = false): void {
  freePlay = chain === undefined && tutorial !== 'growth';
  stopAfterMerge = chain !== undefined; effectTail = 0; growthReady = tutorial === 'growth';
  effects.clear(); audio.suspend(); aim = null; input.cancel(); list.replaceChildren(); bank = 0; time = 0;
  document.querySelector('#cooling')!.textContent = '';
  if (chain === undefined) {
    sim = createSimulation(21, tutorial === 'growth' ? setupGrowthPreview() : tutorial === 'collapse' ? setupInterventionPractice() : tutorial ? setupTwoChain() : undefined);
    document.querySelector('#mode')!.textContent = tutorial === 'growth' ? '破線は静止した盤面での成長後の目安。赤は限界を越える可能性です。動いた結果や敗北は断定しません。「この照準で撃つ」で実際の続きを見られます。' : tutorial === 'collapse' ? '練習用の途中盤面です。12組の合体でゲージが満ちます。一投してから1.2秒以内に「撃った後に崩壊」を押してください。使えるのは一投につき一度、ゲージが満ちた時だけです。' : tutorial ? '盤面の真上で押して離してください。最初の合体が隣へつながると2連鎖です。連鎖数を仕込まず、本番と同じ計算でつなげます。' : '盤面を押して離すと核へ落とします。引いて離すと投げます。';
  } else {
    const r = TIER_RADIUS[0];
    const saved = createSimulation(21, { heat: 80, bodies: [{ tier: 0, x: 130, y: -r }, { tier: 0, x: 130, y: r }] }).exportState();
    sim = restoreSimulation({ ...saved, bodies: saved.bodies.map((b, i) => i === 0 ? { ...b, chain: chain - 1, chainUntilTick: 300 } : b) });
      document.querySelector('#mode')!.textContent = `検証用: ${chain}連鎖目の直前、熱80から再生し、合体直後に自動停止。続けると毎秒${HEAT_COOL_PER_SECOND}の自然冷却も見られます。`;
  }
  prev = curr = sim.getSnapshot(); running = !growthReady; input.setEnabled(running && freePlay); unlock();
  if (growthReady) aim = { ...GROWTH_PREVIEW_COMMAND, tier: curr.nextQueue[0], dragPx: 80, speed: Math.hypot(GROWTH_PREVIEW_COMMAND.vx, GROWTH_PREVIEW_COMMAND.vy), straight: false, invalid: false, prediction: sim.predict(GROWTH_PREVIEW_COMMAND) };
  startHeat = curr.heat; mergeCooling = 0; interventionCooling = 0; passiveChange = 0;
  document.querySelector('#pause')!.textContent = '一時停止';
}
function draw(): void {
  renderer.draw({ prev, curr, alpha: Math.min(1, bank / DT), timeSeconds: time, aim, reducedMotion: false, aimGuide: true, dimmed: !running });
  effects.draw();
  document.querySelector('#heat')!.textContent = curr.heat.toFixed(1);
  document.querySelector<HTMLMeterElement>('#meter')!.value = curr.heat;
  document.querySelector('#cooling')!.textContent = `この場面の合体冷却 合計 −${Number(mergeCooling.toFixed(1))}`;
  document.querySelector('#balance')!.textContent = `開始 ${startHeat.toFixed(1)} − 合体 ${mergeCooling.toFixed(1)} − 崩壊 ${interventionCooling.toFixed(1)} ${passiveChange >= 0 ? '＋' : '−'} 自然変化 ${Math.abs(passiveChange).toFixed(1)} = 現在 ${curr.heat.toFixed(1)}`;
  document.querySelector('#facts')!.textContent = `得点 ${curr.score.toLocaleString()}\n次の3個: ${curr.nextQueue.map((tier) => `Tier ${tier}`).join(' → ')}\n合体 ${curr.stats.merges}回 / 最長 ${curr.stats.maxChain}連鎖`;
  const intervention = curr.intervention;
  document.querySelector<HTMLButtonElement>('#collapse')!.disabled = !running || !intervention?.ready;
  document.querySelector<HTMLButtonElement>('#growth-launch')!.disabled = !growthReady;
  document.querySelector('#intervention-status')!.textContent = !intervention?.unlocked ? '崩壊はTier3で解放' :
    `ゲージ ${intervention.charge}/${intervention.max} / ${intervention.used ? 'この投では使用済み' : intervention.ready ? `使える時間 ${intervention.windowLeftSeconds.toFixed(1)}秒` : '次の一投とゲージを待つ'}`;
}
document.querySelector('#play')!.addEventListener('click', () => begin());
document.querySelector('#learn')!.addEventListener('click', () => begin(undefined, true));
document.querySelector('#intervention-practice')!.addEventListener('click', () => begin(undefined, 'collapse'));
document.querySelector('#collapse')!.addEventListener('click', () => { if (running) { unlock(); sim.submitGravity({ kind: 'collapse' }); curr = sim.getSnapshot(); } });
document.querySelector('#growth-preview')!.addEventListener('click', () => begin(undefined, 'growth'));
document.querySelector('#growth-launch')!.addEventListener('click', () => { if (growthReady && sim.submitLaunch(GROWTH_PREVIEW_COMMAND).accepted) { growthReady = false; aim = null; running = true; curr = sim.getSnapshot(); } });
document.querySelector('#profile')!.addEventListener('click', () => { profileActive = true; paintSamples = []; intervalSamples = []; profileBodies = 0; document.querySelector('#profile-result')!.textContent = '計測中…'; });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-chain]')) button.addEventListener('click', () => begin(Number(button.dataset.chain)));
document.querySelector('#pause')!.addEventListener('click', () => { running = !running; input.setEnabled(running && freePlay); audio.suspend(); if (running) unlock(); document.querySelector('#pause')!.textContent = running ? '一時停止' : '再開'; });
sound.addEventListener('change', () => { if (sound.checked && running) unlock(); else audio.suspend(); });
new ResizeObserver(() => { const size = stage.clientWidth; renderer.resize(size); effects.resize(size); draw(); }).observe(stage);
function frame(now: number): void {
  const elapsed = now - last, dt = Math.min(0.05, elapsed / 1000); last = now;
  if (running) {
    bank += dt; time += dt;
    while (bank >= DT && curr.phase === 'active' && running) { prev = curr; const events = sim.stepFixed(); curr = sim.getSnapshot(); bank -= DT; append(events, curr); }
    if (curr.phase === 'over') { running = false; bank = 0; input.setEnabled(false); audio.suspend(); }
  }
  if (running || effectTail > 0) { effects.update(dt); effectTail = Math.max(0, effectTail - dt); }
  if (!running) bank = 0;
  const started = performance.now(); draw();
  if (profileActive) {
    paintSamples.push(performance.now() - started); intervalSamples.push(elapsed); profileBodies = Math.max(profileBodies, curr.bodies.length);
    if (paintSamples.length >= 180) {
      const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]!;
      document.querySelector('#profile-result')!.textContent = `180コマ / 最大${profileBodies}体 / 描画JS p95 ${p95(paintSamples).toFixed(2)}ms / rAF間隔p95 ${p95(intervalSamples).toFixed(1)}ms`;
      profileActive = false;
    }
  }
  requestAnimationFrame(frame);
}
begin(3); running = false; document.querySelector('#pause')!.textContent = '再開'; requestAnimationFrame(frame);
