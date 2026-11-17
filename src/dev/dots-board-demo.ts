import '../styles/dots-board.css';
import { paintDotsBoard, paintDotsQueue, type DotsVariant } from './dots-board-art';

const params = new URLSearchParams(window.location.search);
const requested = params.get('案');
let variant: DotsVariant = requested === 'b' || requested === 'c' ? requested : 'a';
const captions: Record<DotsVariant, string> = {
  a: '64列。面を埋めた点と明暗で、天体の重さを見せます。',
  b: '80列。途切れない外周と独立した芯で、天体の形を見せます。',
  c: '80列。合体点から広がる同心の点の波を、盤面の端まで見せます。',
};
const board = document.querySelector<HTMLCanvasElement>('#board-study')!;
const queue = document.querySelector<HTMLCanvasElement>('#queue-study')!;
const buttons = document.querySelectorAll<HTMLButtonElement>('[data-variant]');
const caption = document.querySelector<HTMLElement>('#study-caption')!;
const gray = document.querySelector<HTMLInputElement>('#study-gray')!;
const heat = document.querySelector<HTMLElement>('#heat-dots')!;

document.documentElement.classList.toggle('is-shot', params.has('shot'));
for (let index = 0; index < 20; index += 1) {
  const dot = document.createElement('i');
  if (index < Math.round(20 * .38)) dot.dataset.lit = '';
  heat.append(dot);
}

function render(): void {
  paintDotsBoard(board, variant);
  paintDotsQueue(queue, variant);
  caption.textContent = captions[variant];
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.variant === variant));
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    variant = button.dataset.variant as DotsVariant;
    render();
  });
}
gray.addEventListener('change', () => document.documentElement.classList.toggle('is-gray', gray.checked));
render();
