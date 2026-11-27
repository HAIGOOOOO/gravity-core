import '../styles/dots-board.css';
import { HEAT_MAX, MAX_FRAME_SECONDS } from '../game/constants';
import { paintDotsBoard, paintDotsQueue, paintMovingDotsBoard, type DotsVariant } from './dots-board-art';
import { createDotsPlayback } from './dots-motion';
import { dotsCamera } from './dots-motion-effects';

const params = new URLSearchParams(window.location.search);
const requested = params.get('案');
let variant: DotsVariant = requested === 'b' || requested === 'c' ? requested : 'a';
const captions: Record<DotsVariant, string> = {
  a: '64列。面を埋めた点と明暗で、天体の重さを見せます。',
  b: '80列。途切れない外周と独立した芯で、天体の形を見せます。',
  c: '80列。輪と芯に加え、合体時は盤面の端まで波が届きます。',
};
const board = document.querySelector<HTMLCanvasElement>('#board-study')!;
const queue = document.querySelector<HTMLCanvasElement>('#queue-study')!;
const buttons = document.querySelectorAll<HTMLButtonElement>('[data-variant]');
const caption = document.querySelector<HTMLElement>('#study-caption')!;
const gray = document.querySelector<HTMLInputElement>('#study-gray')!;
const reduced = document.querySelector<HTMLInputElement>('#study-reduced')!;
const heat = document.querySelector<HTMLElement>('#heat-dots')!;
const score = document.querySelector<HTMLElement>('#study-score')!;
const time = document.querySelector<HTMLElement>('#study-time')!;
const heatNumber = document.querySelector<HTMLElement>('#study-heat')!;
const status = document.querySelector<HTMLElement>('#study-status')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#study-pause')!;
const playback = createDotsPlayback();
const shot = params.has('shot');
let paused = false;
let dirty = true;
let previous = performance.now();
let latest = playback.update(0, false);

reduced.checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
document.documentElement.classList.toggle('is-shot', shot);
for (let index = 0; index < 20; index += 1) heat.append(document.createElement('i'));

function setHeat(value: number): void {
  heatNumber.textContent = Math.round(value).toString();
  Array.from(heat.children).forEach((dot, index) =>
    dot.toggleAttribute('data-lit', index < Math.round(20 * value / HEAT_MAX)));
}

function select(): void {
  caption.textContent = captions[variant];
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.variant === variant));
  paintDotsQueue(queue, variant);
  dirty = true;
}

function replay(): void {
  playback.reset();
  latest = playback.update(0, reduced.checked);
  paused = false;
  pauseButton.textContent = '一時停止';
  dirty = true;
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    variant = button.dataset.variant as DotsVariant;
    replay();
    select();
  });
}
document.querySelector('#study-replay')!.addEventListener('click', replay);
pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.textContent = paused ? '再開' : '一時停止';
  pauseButton.setAttribute('aria-pressed', String(paused));
  dirty = true;
});
gray.addEventListener('change', () => document.documentElement.classList.toggle('is-gray', gray.checked));
reduced.addEventListener('change', () => { dirty = true; });

function frame(now: number): void {
  const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - previous) / 1000));
  previous = now;
  if (document.hidden || paused && !dirty) {
    requestAnimationFrame(frame);
    return;
  }
  if (!paused) latest = playback.update(seconds, reduced.checked);
  dirty = false;
  const { snapshot, bodies, impacts, elapsed, cycle } = latest;
  paintMovingDotsBoard(board, variant, snapshot, bodies, impacts, elapsed, reduced.checked);
  const camera = dotsCamera(impacts.at(-1), reduced.checked);
  const size = board.clientWidth / 366;
  board.style.transform = `translate(${camera.x * size}px, ${camera.y * size}px)`;
  score.textContent = snapshot.score.toLocaleString('ja-JP');
  time.textContent = `00:${Math.floor(elapsed).toString().padStart(2, '0')}`;
  setHeat(snapshot.heat);
  const state = paused ? '静止中' : snapshot.stats.maxChain === 3 ? '3連鎖の余韻' :
    snapshot.stats.maxChain > 0 ? `${snapshot.stats.maxChain}連鎖` : '落下';
  status.textContent = `${state}・実計算tick ${snapshot.tick}・${cycle}周目。全案で同じ配置と計算を使っています。`;
  requestAnimationFrame(frame);
}

select();
if (shot) {
  document.querySelector('#study-time-title')!.textContent = '残り時間';
  time.textContent = '01:42';
  score.textContent = '12,480';
  setHeat(38);
  paintDotsBoard(board, variant);
} else {
  requestAnimationFrame(frame);
}
