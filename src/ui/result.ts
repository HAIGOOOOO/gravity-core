import type { OverlayData, UiIntent } from '../contracts/app';
import type { Tier } from '../contracts/game';
import { TIER_NAMES } from '../game/constants';
import { bodyIcon, paintBodyIcon } from './body-icon';
import { element, action } from './dom';
import { STRINGS, rankLabel } from './strings';
import { durationLabel } from './format';

export function appendResult(card: HTMLElement, data: OverlayData, onIntent: (intent: UiIntent) => void): (next: OverlayData) => void {
  const score = element('strong', 'result-score');
  const best = element('p', 'result-best', STRINGS.bestUpdated);
  const rank = element('p', 'result-rank'); rank.setAttribute('aria-live', 'polite');
  const body = bodyIcon(0);
  const tierName = element('span');
  const tier = element('div', 'result-tier'); tier.append(body, tierName);
  const stats = element('dl', 'result-stats');
  const fields = new Map<string, HTMLElement>();
  for (const label of [STRINGS.maxChain, STRINGS.playTime, STRINGS.launches, STRINGS.merges]) {
    const value = element('dd'); fields.set(label, value);
    const group = element('div'); group.append(element('dt', '', label), value); stats.append(group);
  }
  const label = element('label', 'name-field', STRINGS.playerName);
  const name = element('input'); name.type = 'text'; name.maxLength = 12; name.value = data.playerName; name.setAttribute('autocomplete', 'nickname');
  name.setAttribute('aria-label', STRINGS.playerName);
  name.addEventListener('input', () => onIntent({ kind: 'rename', name: name.value }));
  label.append(name, element('small', '', STRINGS.nameHelp));
  const buttons = element('div', 'overlay-actions');
  for (const [text, intent] of [[STRINGS.retry, 'restart'], [STRINGS.seeRanking, 'openRanking'], [STRINGS.copyResult, 'copyResult'], [STRINGS.backToTitle, 'backToTitle']] as const) {
    buttons.append(action(text, () => onIntent({ kind: intent }), intent === 'restart' ? 'primary' : ''));
  }
  card.append(score, best, rank, tier, stats, element('p', 'result-reason', STRINGS.resultReason), label, buttons);
  function update(next: OverlayData): void {
    if (!next.result) return;
    const { record, isBest, rank: position } = next.result;
    score.textContent = record.score.toLocaleString('ja-JP');
    best.hidden = !isBest;
    rank.textContent = position === null ? '' : rankLabel(position);
    rank.hidden = position === null;
    paintBodyIcon(body, record.bestTier as Tier);
    tierName.textContent = `${STRINGS.bestTier} · ${TIER_NAMES[record.bestTier]}`;
    const values = [String(record.maxChain), durationLabel(record.seconds), String(record.launches), String(record.merges)];
    Array.from(fields.values()).forEach((field, i) => { field.textContent = values[i]!; });
  }
  update(data);
  return update;
}
