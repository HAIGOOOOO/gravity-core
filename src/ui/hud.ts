import type { Hud, UiIntent } from '../contracts/app';
import { TIER_NAMES, HEAT_MAX } from '../game/constants';
import { HEAT_STATE_LABEL, heatState } from '../shared/heat';
import { element, action } from './dom';
import { STRINGS } from './strings';

export function createHud(root: HTMLElement, onIntent: (intent: UiIntent) => void): Hud {
  const logo = element('div', 'hud-logo', STRINGS.title);
  const score = element('strong', 'score-value', '0');
  const best = element('span', 'best-value');
  const scoreBlock = element('section', 'hud-score');
  scoreBlock.append(element('span', 'label', STRINGS.score), score, best);
  const heat = element('span', 'heat-value');
  const heatBlock = element('section', 'hud-heat');
  heatBlock.append(element('span', 'label', STRINGS.heat), heat);
  const queue = element('div', 'queue-values');
  const next = element('section', 'hud-next');
  next.append(element('span', 'label', STRINGS.next), queue);
  const controls = element('div', 'hud-controls');
  controls.append(action(STRINGS.paused, () => onIntent({ kind: 'pause' })),
    action(STRINGS.sound, () => onIntent({ kind: 'toggleSfx' })));
  const toast = element('div', 'toast');
  root.replaceChildren(logo, scoreBlock, heatBlock, next, controls, toast);
  let timer = 0;
  return {
    update(snapshot, bestScore) {
      score.textContent = snapshot.score.toLocaleString('ja-JP');
      best.textContent = `${STRINGS.best} ${bestScore.toLocaleString('ja-JP')}`;
      heat.textContent = `${Math.floor(snapshot.heat)} / ${HEAT_MAX} ${HEAT_STATE_LABEL[heatState(snapshot.heat)]}`;
      queue.textContent = snapshot.nextQueue.map(t => TIER_NAMES[t]).join(' · ');
    },
    showToast(text, seconds = 3) {
      toast.textContent = text;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { toast.textContent = ''; }, seconds * 1000);
    },
    showChain(chain) { this.showToast(`${STRINGS.effectChain} ×${chain}`, 2); },
    setSfxOn() {},
  };
}
