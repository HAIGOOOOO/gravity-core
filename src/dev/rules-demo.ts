import type { AimView } from '../contracts/app';
import type { GameEvent, GameSnapshot } from '../contracts/game';
import { createAudioManager } from '../audio';
import { createEffectsLayer } from '../effects';
import { createPointerInput } from '../input';
import { createBoardRenderer } from '../render';
import { createSimulation, restoreSimulation, type Simulation } from '../game/simulation';
import { DT, HEAT_COOL_PER_SECOND, TIER_RADIUS } from '../game/constants';

const board = document.querySelector<HTMLCanvasElement>('#board')!;
const canvas = document.querySelector<HTMLCanvasElement>('#effects')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const renderer = createBoardRenderer(board), effects = createEffectsLayer(canvas, stage), audio = createAudioManager();
const sound = document.querySelector<HTMLInputElement>('#sound')!;
const list = document.querySelector<HTMLOListElement>('#events')!;
let sim: Simulation = createSimulation(21), prev = sim.getSnapshot(), curr = prev;
let aim: AimView | null = null, running = false, bank = 0, last = performance.now(), time = 0;

function unlock(): void {
  if (sound.checked) { audio.unlock(); audio.setSettings({ sfx: true, volume: 65 }); audio.resume(); }
}
const input = createPointerInput(board, {
  getSnapshot: () => sim.getSnapshot(), predict: (command) => sim.predict(command), onAim: (value) => { aim = value; },
  onLaunch: (command) => { unlock(); sim.submitLaunch(command); },
});
function append(events: readonly GameEvent[], snapshot: GameSnapshot): void {
  effects.handleEvents(events, snapshot);
  if (sound.checked) audio.handleEvents(events, snapshot);
  for (const e of events) {
    if (e.kind !== 'merge' && e.kind !== 'supernova' && e.kind !== 'gameOver') continue;
    const li = document.createElement('li');
    li.textContent = e.kind === 'gameOver' ? '熱量100で終了' : `${e.chain}連鎖 / 熱量${e.heatDelta ?? 0} / +${e.scoreDelta}点`;
    list.prepend(li); if (list.children.length > 8) list.lastElementChild!.remove();
    if ((e.heatDelta ?? 0) < 0) document.querySelector('#cooling')!.textContent = `合体で ${e.heatDelta} 冷却`;
  }
}
function begin(chain?: number): void {
  effects.clear(); audio.suspend(); aim = null; input.cancel(); list.replaceChildren(); bank = 0; time = 0;
  document.querySelector('#cooling')!.textContent = '';
  if (chain === undefined) {
    sim = createSimulation(21);
    document.querySelector('#mode')!.textContent = '盤面を押して離すと核へ落とします。引いて離すと投げます。';
  } else {
    const r = TIER_RADIUS[0];
    const saved = createSimulation(21, { heat: 80, bodies: [{ tier: 0, x: 130, y: -r }, { tier: 0, x: 130, y: r }] }).exportState();
    sim = restoreSimulation({ ...saved, bodies: saved.bodies.map((b, i) => i === 0 ? { ...b, chain: chain - 1, chainUntilTick: 300 } : b) });
    document.querySelector('#mode')!.textContent = `検証用: ${chain}連鎖目の直前、熱80から再生。合体の冷却に加え、限界内では毎秒${HEAT_COOL_PER_SECOND}ずつ冷めます。`;
  }
  prev = curr = sim.getSnapshot(); running = true; input.setEnabled(chain === undefined); unlock();
  document.querySelector('#pause')!.textContent = '一時停止';
}
function draw(): void {
  renderer.draw({ prev, curr, alpha: Math.min(1, bank / DT), timeSeconds: time, aim, reducedMotion: false, aimGuide: true, dimmed: !running });
  effects.draw();
  document.querySelector('#heat')!.textContent = curr.heat.toFixed(1);
  document.querySelector<HTMLMeterElement>('#meter')!.value = curr.heat;
  document.querySelector('#facts')!.textContent = `得点 ${curr.score.toLocaleString()}\n次の3個: ${curr.nextQueue.map((tier) => `Tier ${tier}`).join(' → ')}\n合体 ${curr.stats.merges}回 / 最長 ${curr.stats.maxChain}連鎖`;
}
document.querySelector('#play')!.addEventListener('click', () => begin());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-chain]')) button.addEventListener('click', () => begin(Number(button.dataset.chain)));
document.querySelector('#pause')!.addEventListener('click', () => { running = !running; input.setEnabled(running); audio.suspend(); if (running) unlock(); document.querySelector('#pause')!.textContent = running ? '一時停止' : '再開'; });
sound.addEventListener('change', () => { if (sound.checked && running) unlock(); else audio.suspend(); });
new ResizeObserver(() => { const size = stage.clientWidth; renderer.resize(size); effects.resize(size); draw(); }).observe(stage);
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (running) {
    bank += dt; time += dt;
    while (bank >= DT && curr.phase === 'active') { prev = curr; const events = sim.stepFixed(); curr = sim.getSnapshot(); append(events, curr); bank -= DT; }
    if (curr.phase === 'over') { running = false; bank = 0; input.setEnabled(false); audio.suspend(); }
    effects.update(dt);
  }
  draw(); requestAnimationFrame(frame);
}
begin(3); requestAnimationFrame(frame);
