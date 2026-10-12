import type { Hud, UiIntent } from '../contracts/app';
import { HEAT_MAX, CHAIN_STEP, CHAIN_MULT_MAX } from '../game/constants';
import { HEAT_STATE_LABEL, HEAT_STATE_COLOR_VAR, heatState } from '../shared/heat';
import { element, action } from './dom';
import { STRINGS, chainLabel } from './strings';
import { bodyIcon, paintBodyIcon } from './body-icon';

const COUNT_MS = 300;
const CHAIN_MS = 2000;

export function createHud(root: HTMLElement, onIntent: (intent: UiIntent) => void): Hud {
  const logo = element('div', 'hud-logo', STRINGS.title);
  const score = element('strong', 'score-value', '0');
  const best = element('span', 'best-value');
  const scoreBlock = element('section', 'hud-score');
  scoreBlock.append(element('span', 'label', STRINGS.score), score, best);
  const heat = element('span', 'heat-value');
  heat.setAttribute('aria-live', 'polite');
  heat.setAttribute('aria-atomic', 'true');
  const meter = element('div', 'heat-meter');
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', STRINGS.heat);
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(HEAT_MAX));
  const fill = element('div', 'heat-fill');
  meter.append(fill);
  const heatBlock = element('section', 'hud-heat');
  heatBlock.append(element('span', 'label', STRINGS.heat), meter, heat);
  const queue = element('div', 'queue-values');
  const icons = [bodyIcon(0), bodyIcon(0), bodyIcon(0)];
  queue.append(...icons);
  const next = element('section', 'hud-next');
  next.append(element('span', 'label', STRINGS.next), queue);
  const controls = element('div', 'hud-controls');
  const pause = action('Ⅱ', () => onIntent({ kind: 'pause' }));
  pause.setAttribute('aria-label', STRINGS.pause);
  const sound = action('♪', () => onIntent({ kind: 'toggleSfx' }));
  controls.append(pause, sound, action(STRINGS.ranking, () => onIntent({ kind: 'openRanking' }), 'hud-ranking'));
  const toast = element('div', 'toast');
  toast.setAttribute('role', 'status');
  const chain = element('div', 'chain-notice');
  root.replaceChildren(logo, scoreBlock, heatBlock, next, controls);
  // 盤面を基準に置くので、横の情報パネルを覆わない。
  (root.parentElement?.querySelector('#board-wrap') ?? root).append(chain, toast);
  let timer = 0;
  let chainTimer = 0;
  let frame = 0;
  let displayed = 0;
  let target = -1;
  let lastBest = -1;
  let lastHeat = -1;
  let lastQueue = '';
  let lastTick = 0;
  function setScore(value: number): void {
    const text = Math.round(value).toLocaleString('ja-JP');
    if (score.textContent !== text) score.textContent = text;
    displayed = value;
  }
  function countTo(value: number): void {
    cancelAnimationFrame(frame);
    const start = performance.now();
    const from = displayed;
    const reduced = document.documentElement.dataset.reducedMotion === 'true'
      || (document.documentElement.dataset.reducedMotion !== 'false' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (value < target || target < 0 || reduced) { setScore(value); target = value; return; }
    target = value;
    function tick(now: number): void {
      const fraction = Math.min(1, (now - start) / COUNT_MS);
      setScore(from + (value - from) * (1 - (1 - fraction) ** 3));
      if (fraction < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }
  const hud: Hud = {
    update(snapshot, bestScore) {
      if (snapshot.tick < lastTick) {
        chain.textContent = '';
        // 開始の案内はアプリがすでに出しているので、消さない。
        clearTimeout(chainTimer);
      }
      lastTick = snapshot.tick;
      if (snapshot.score !== target) countTo(snapshot.score);
      if (bestScore !== lastBest) {
        best.textContent = `${STRINGS.best} ${bestScore.toLocaleString('ja-JP')}`;
        lastBest = bestScore;
      }
      const value = Math.floor(Math.max(0, Math.min(HEAT_MAX, snapshot.heat)));
      if (value !== lastHeat) {
        const state = heatState(value);
        heat.textContent = `${value} / ${HEAT_MAX} ${HEAT_STATE_LABEL[state]}`;
        meter.setAttribute('aria-valuenow', String(value));
        meter.setAttribute('aria-valuetext', heat.textContent);
        heatBlock.style.setProperty('--heat-color', `var(${HEAT_STATE_COLOR_VAR[state]})`);
        fill.style.width = `${value / HEAT_MAX * 100}%`;
        lastHeat = value;
      }
      const key = snapshot.nextQueue.join(',');
      if (key !== lastQueue) {
        snapshot.nextQueue.forEach((tier, index) => paintBodyIcon(icons[index]!, tier));
        lastQueue = key;
      }
    },
    showToast(text, seconds = 3) {
      toast.textContent = text;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { toast.textContent = ''; }, seconds * 1000);
    },
    showChain(value) {
      chain.textContent = chainLabel(value, Math.min(CHAIN_MULT_MAX, 1 + CHAIN_STEP * (value - 1)));
      clearTimeout(chainTimer);
      chainTimer = window.setTimeout(() => { chain.textContent = ''; }, CHAIN_MS);
    },
    setSfxOn(on) {
      sound.textContent = on ? '♪' : '♪ ×';
      sound.setAttribute('aria-label', on ? STRINGS.soundOn : STRINGS.soundOff);
      sound.setAttribute('aria-pressed', String(on));
    },
  };
  hud.setSfxOn(true);
  return hud;
}
