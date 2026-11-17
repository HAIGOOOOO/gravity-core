import { paintDotsMotion, paintNextDot } from './dots-motion-draw';
import { CLIP_SECONDS, FIRST_FRAME, sampleDotsMotion, type ClipName, type MotionChoice } from './dots-motion-model';

const clipButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-clip]')];
const choiceButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-choice]')];
const boards = [...document.querySelectorAll<HTMLElement>('figure[data-preview]')].map(figure => {
  const canvas = figure.querySelector('canvas')!;
  return { figure, canvas, ctx: canvas.getContext('2d')!, choice: figure.dataset.preview as MotionChoice };
});
const playButton = document.querySelector<HTMLButtonElement>('#play')!;
const timeline = document.querySelector<HTMLInputElement>('#timeline')!;
const clock = document.querySelector<HTMLOutputElement>('#clock')!;
const score = document.querySelector<HTMLOutputElement>('#score')!;
const heat = document.querySelector<HTMLOutputElement>('#heat')!;
const reduced = document.querySelector<HTMLInputElement>('#reduced-motion')!;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const compact = matchMedia('(max-width: 850px)');
reduced.checked = motion.matches;
let clip: ClipName = 'merge', choice: MotionChoice = 'flow', seconds = FIRST_FRAME;
let playing = false, previewStill = true, last = 0, frameRequest = 0;

function draw(): void {
  const sample = sampleDotsMotion(clip, seconds, reduced.checked);
  for (const { canvas, ctx, choice: variant } of boards) {
    if (compact.matches && variant !== choice) continue;
    const width = Math.round(canvas.clientWidth * (devicePixelRatio || 1));
    if (!width) continue;
    if (canvas.width !== width || canvas.height !== width) canvas.width = canvas.height = width;
    paintDotsMotion(ctx, width, variant, sample, seconds, reduced.checked);
  }
  timeline.value = String(Math.round(seconds * 100));
  clock.value = `${seconds.toFixed(2)} / ${CLIP_SECONDS.toFixed(2)} 秒`;
  score.value = sample.points.toLocaleString('ja-JP');
  heat.value = String(sample.heat);
}

function stop(): void {
  playing = false;
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  playButton.textContent = '再生';
}

function tick(now: number): void {
  if (!playing) return;
  seconds = Math.min(CLIP_SECONDS, seconds + (now - last) / 1000);
  last = now;
  draw();
  if (seconds >= CLIP_SECONDS) stop();
  else frameRequest = requestAnimationFrame(tick);
}

function play(from: number): void {
  seconds = from;
  previewStill = false; playing = true; last = performance.now();
  playButton.textContent = '一時停止';
  draw();
  frameRequest = requestAnimationFrame(tick);
}

playButton.addEventListener('click', () => {
  if (playing) stop();
  else play(seconds >= CLIP_SECONDS || previewStill ? 0 : seconds);
});
timeline.addEventListener('input', () => {
  stop();
  previewStill = false;
  seconds = Number(timeline.value) / 100;
  draw();
});
for (const button of clipButtons) button.addEventListener('click', () => {
  stop();
  clip = button.dataset.clip as ClipName;
  for (const option of clipButtons) option.setAttribute('aria-pressed', String(option === button));
  play(0);
});
for (const button of choiceButtons) button.addEventListener('click', () => {
  choice = button.dataset.choice as MotionChoice;
  for (const option of choiceButtons) option.setAttribute('aria-pressed', String(option === button));
  for (const board of boards) board.figure.dataset.current = String(board.choice === choice);
  draw();
});
const nextDots = [...document.querySelectorAll<HTMLCanvasElement>('[data-next]')];
function resize(): void {
  for (const canvas of nextDots) {
    const size = Math.round(canvas.clientWidth * (devicePixelRatio || 1));
    canvas.width = canvas.height = size;
    paintNextDot(canvas.getContext('2d')!, size, Number(canvas.dataset.next) as 0 | 1 | 2);
  }
  draw();
}
reduced.addEventListener('change', draw);
motion.addEventListener('change', () => { reduced.checked = motion.matches; draw(); });
compact.addEventListener('change', resize);
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
resize();
