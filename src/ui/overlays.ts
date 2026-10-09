import type { OverlayData, OverlayScreen, Overlays, UiIntent } from '../contracts/app';
import { element, action } from './dom';
import { STRINGS } from './strings';
import { illustration } from './illustrations';
import { appendSettings } from './settings';
import { appendResult } from './result';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]';
export function createOverlays(root: HTMLElement, onIntent: (intent: UiIntent) => void): Overlays {
  let shown: OverlayScreen | null = null;
  let latest: OverlayData;
  let previous: OverlayScreen | null = null;
  let returnFocus: HTMLElement | null = null;
  let card: HTMLElement | null = null;
  let confirmation: HTMLElement | null = null;
  let updateResult: ((data: OverlayData) => void) | null = null;
  let resultId: string | undefined;
  let bestLabel: HTMLElement | null = null;
  function send(intent: UiIntent): void {
    if (intent.kind === 'start' || intent.kind === 'restart' || intent.kind === 'backToTitle') {
      for (const node of root.parentElement?.querySelectorAll('.chain-notice,.toast') ?? []) node.textContent = '';
    }
    onIntent(intent);
  }
  function confirm(message: string, handler: () => void): void {
    if (!card || confirmation) return;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmation = element('section', 'confirmation');
    confirmation.setAttribute('role', 'alertdialog');
    confirmation.setAttribute('aria-label', message);
    const close = () => { confirmation?.remove(); confirmation = null; focus?.focus(); };
    const cancel = action(STRINGS.cancel, close);
    confirmation.append(element('p', '', message), cancel, action(STRINGS.confirm, () => { close(); handler(); }, 'primary'));
    card.append(confirmation); cancel.focus();
  }
  function openLocal(screen: 'settings' | 'howto'): void { previous = shown; show(screen, latest); }
  function closeLocal(): void { const next = previous ?? 'title'; previous = null; show(next, latest); }
  function show(screen: OverlayScreen | null, data: OverlayData): void {
    document.documentElement.dataset.reducedMotion = String(data.settings.reducedMotion);
    if (screen !== null && screen === shown && card && (screen !== 'result' || data.result?.record.id === resultId)) {
      latest = { ...data, playerName: latest.playerName };
      updateResult?.(data);
      if (bestLabel) bestLabel.textContent = `${STRINGS.best} ${data.bestScore.toLocaleString('ja-JP')}`;
      return;
    }
    if (shown === null && screen !== null) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    shown = screen;
    latest = { ...data, settings: { ...data.settings } };
    root.replaceChildren(); root.hidden = screen === null;
    card = null; confirmation = null; updateResult = null; bestLabel = null;
    if (screen === null) {
      previous = null;
      root.parentElement?.querySelectorAll<HTMLElement>('#board-wrap,#hud').forEach(node => { node.inert = false; });
      returnFocus?.focus(); return;
    }
    root.parentElement?.querySelectorAll<HTMLElement>('#board-wrap,#hud').forEach(node => { node.inert = true; });
    card = element('section', `card screen-${screen}`);
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'overlay-heading');
    const heading = element('h1'); heading.id = 'overlay-heading';
    heading.textContent = screen === 'title' ? STRINGS.title : screen === 'howto' ? STRINGS.howto : screen === 'settings' ? STRINGS.settings : screen === 'paused' ? STRINGS.paused : STRINGS.gameOver;
    card.append(heading);
    if (screen === 'title') {
      card.prepend(element('p', 'eyebrow', STRINGS.observatory));
      card.append(element('div', 'title-instrument'), element('p', 'title-tagline', STRINGS.tagline), element('p', 'title-note', STRINGS.titleNote));
      bestLabel = element('p', 'title-best', `${STRINGS.best} ${data.bestScore.toLocaleString('ja-JP')}`); card.append(bestLabel);
      const buttons = element('div', 'overlay-actions');
      buttons.append(action(STRINGS.start, () => send({ kind: 'start' }), 'primary'), action(STRINGS.howto, () => openLocal('howto')),
        action(STRINGS.ranking, () => send({ kind: 'openRanking' })), action(STRINGS.settings, () => openLocal('settings')));
      card.append(buttons);
    } else if (screen === 'howto') {
      STRINGS.howtoSteps.forEach((text, i) => {
        const step = element('div', 'howto-step'); step.append(illustration(i), element('p', '', `${i + 1}. ${text}`)); card!.append(step);
      });
      card.append(action(STRINGS.close, closeLocal, 'primary'));
    } else if (screen === 'settings') appendSettings(card, latest, onIntent, confirm, closeLocal);
    else if (screen === 'paused') {
      card.append(action(STRINGS.resume, () => send({ kind: 'resume' }), 'primary'),
        action(STRINGS.restart, () => confirm(STRINGS.confirmDiscard, () => send({ kind: 'restart' }))),
        action(STRINGS.settings, () => openLocal('settings')),
        action(STRINGS.backToTitle, () => confirm(STRINGS.confirmDiscard, () => send({ kind: 'backToTitle' }))));
    } else {
      resultId = data.result?.record.id;
      updateResult = appendResult(card, data, send);
    }
    root.append(card);
    (card.querySelector<HTMLElement>('button.primary') ?? card.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
  }
  root.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (confirmation) { confirmation.querySelector<HTMLButtonElement>('button')?.click(); return; }
      if (shown === 'howto' || shown === 'settings') closeLocal();
      else if (shown === 'paused') send({ kind: 'resume' });
    }
    if (event.key !== 'Tab') return;
    const nodes = Array.from((confirmation ?? card)?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(node => !node.hidden);
    const first = nodes[0]; const last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  return { show, current: () => shown };
}
