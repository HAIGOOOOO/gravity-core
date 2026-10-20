import type { AimView } from '../contracts/app';
import type { GameEvent, GameSnapshot } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer } from '../effects';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { createSimulation, restoreSimulation, type Simulation } from '../game/simulation';
import { DT, HEAT_COOL_PER_SECOND, TIER_RADIUS } from '../game/constants';
import { setupTwoChain } from '../fixtures/chains';

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
let startHeat = 80, mergeCooling = 0, passiveChange = 0;

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
  passiveChange += snapshot.heat - prev.heat - delta;
  effects.handleEvents(events, snapshot);
  if (sound.checked) audio.handleEvents(events, snapshot);
  for (const e of events) {
    if (e.kind !== 'merge' && e.kind !== 'supernova' && e.kind !== 'gameOver') continue;
    const li = document.createElement('li');
    li.textContent = e.kind === 'gameOver' ? '熱量100で終了' : `${e.chain}連鎖 / 熱量${e.heatDelta ?? 0} / +${e.scoreDelta}点`;
    list.prepend(li); if (list.children.length > 8) list.lastElementChild!.remove();
    if (stopAfterMerge && (e.kind === 'merge' || e.kind === 'supernova')) {
      running = false; stopAfterMerge = false; effectTail = 0.28;
      document.querySelector('#pause')!.textContent = '自然冷却を続ける';
    }
  }
}
function begin(chain?: number, tutorial = false): void {
  freePlay = chain === undefined;
  stopAfterMerge = !freePlay; effectTail = 0;
  effects.clear(); audio.suspend(); aim = null; input.cancel(); list.replaceChildren(); bank = 0; time = 0;
  document.querySelector('#cooling')!.textContent = '';
  if (chain === undefined) {
    sim = createSimulation(21, tutorial ? setupTwoChain() : undefined);
    document.querySelector('#mode')!.textContent = tutorial ? '盤面の真上で押して離してください。最初の合体が隣へつながると2連鎖です。連鎖数を仕込まず、本番と同じ計算でつなげます。' : '盤面を押して離すと核へ落とします。引いて離すと投げます。';
  } else {
    const r = TIER_RADIUS[0];
    const saved = createSimulation(21, { heat: 80, bodies: [{ tier: 0, x: 130, y: -r }, { tier: 0, x: 130, y: r }] }).exportState();
    sim = restoreSimulation({ ...saved, bodies: saved.bodies.map((b, i) => i === 0 ? { ...b, chain: chain - 1, chainUntilTick: 300 } : b) });
      document.querySelector('#mode')!.textContent = `検証用: ${chain}連鎖目の直前、熱80から再生し、合体直後に自動停止。続けると毎秒${HEAT_COOL_PER_SECOND}の自然冷却も見られます。`;
  }
  prev = curr = sim.getSnapshot(); running = true; input.setEnabled(chain === undefined); unlock();
  startHeat = curr.heat; mergeCooling = 0; passiveChange = 0;
  document.querySelector('#pause')!.textContent = '一時停止';
}
function draw(): void {
  renderer.draw({ prev, curr, alpha: Math.min(1, bank / DT), timeSeconds: time, aim, reducedMotion: false, aimGuide: true, dimmed: !running });
  effects.draw();
  document.querySelector('#heat')!.textContent = curr.heat.toFixed(1);
  document.querySelector<HTMLMeterElement>('#meter')!.value = curr.heat;
  document.querySelector('#cooling')!.textContent = `この場面の合体冷却 合計 −${Number(mergeCooling.toFixed(1))}`;
  document.querySelector('#balance')!.textContent = `開始 ${startHeat.toFixed(1)} − 合体 ${mergeCooling.toFixed(1)} ${passiveChange >= 0 ? '＋' : '−'} 自然変化 ${Math.abs(passiveChange).toFixed(1)} = 現在 ${curr.heat.toFixed(1)}`;
  document.querySelector('#facts')!.textContent = `得点 ${curr.score.toLocaleString()}\n次の3個: ${curr.nextQueue.map((tier) => `Tier ${tier}`).join(' → ')}\n合体 ${curr.stats.merges}回 / 最長 ${curr.stats.maxChain}連鎖`;
}
document.querySelector('#play')!.addEventListener('click', () => begin());
document.querySelector('#learn')!.addEventListener('click', () => begin(undefined, true));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-chain]')) button.addEventListener('click', () => begin(Number(button.dataset.chain)));
document.querySelector('#pause')!.addEventListener('click', () => { running = !running; input.setEnabled(running && freePlay); audio.suspend(); if (running) unlock(); document.querySelector('#pause')!.textContent = running ? '一時停止' : '再開'; });
sound.addEventListener('change', () => { if (sound.checked && running) unlock(); else audio.suspend(); });
new ResizeObserver(() => { const size = stage.clientWidth; renderer.resize(size); effects.resize(size); draw(); }).observe(stage);
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (running) {
    bank += dt; time += dt;
    while (bank >= DT && curr.phase === 'active' && running) { prev = curr; const events = sim.stepFixed(); curr = sim.getSnapshot(); bank -= DT; append(events, curr); }
    if (curr.phase === 'over') { running = false; bank = 0; input.setEnabled(false); audio.suspend(); }
  }
  if (running || effectTail > 0) { effects.update(dt); effectTail = Math.max(0, effectTail - dt); }
  if (!running) bank = 0;
  draw(); requestAnimationFrame(frame);
}
begin(3); running = false; document.querySelector('#pause')!.textContent = '再開'; requestAnimationFrame(frame);
