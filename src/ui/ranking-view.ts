import type { RankingStore, RunRecord } from '../contracts/app';
import type { Tier } from '../contracts/game';
import { TIER_NAMES } from '../game/constants';
import { bodyIcon } from './body-icon';
import { element } from './dom';
import { durationLabel } from './format';
import { STRINGS } from './strings';

export async function renderRanking(root: HTMLElement, store: RankingStore, lastRecordId: string | null, fromResult: boolean): Promise<void> {
  const header = element('header', 'ranking-header');
  const logo = element('span', 'ranking-logo', STRINGS.title);
  const back = element('a', 'back-link', STRINGS.backToGame); back.href = 'index.html';
  header.append(logo, back);
  root.replaceChildren(header, element('p', 'ranking-eyebrow', STRINGS.observatory),
    element('h1', '', STRINGS.ranking), element('p', 'ranking-note', STRINGS.rankingNote));
  const records = await store.list(10);
  if (records.length === 0) {
    const empty = element('section', 'ranking-empty');
    const start = element('a', 'start-link', STRINGS.startGame); start.href = 'index.html';
    empty.append(element('p', '', STRINGS.emptyRanking), start); root.append(empty); return;
  }
  const table = element('table', 'ranking-table');
  table.append(element('caption', 'sr-only', STRINGS.rankingNote));
  const head = element('thead'); const headings = element('tr');
  [STRINGS.rank, STRINGS.playerName, STRINGS.score, STRINGS.bestTier, STRINGS.maxChain, STRINGS.playTime, STRINGS.date].forEach((text, index) => {
    const cell = element('th', index > 3 ? 'extra-column' : '', text); cell.scope = 'col'; headings.append(cell);
  });
  head.append(headings); table.append(head);
  const body = element('tbody'); let latest: HTMLTableRowElement | null = null;
  function row(record: RunRecord, index: number): HTMLTableRowElement {
    const node = element('tr');
    const position = element('th', index < 3 ? 'rank-number medal' : 'rank-number', String(index + 1)); position.scope = 'row';
    const name = element('td', 'record-name', record.name);
    if (record.id === lastRecordId) {
      node.className = 'last-record'; latest = node;
      name.append(element('small', 'latest-label', STRINGS.latestRecord));
    }
    const score = element('td', 'record-score', record.score.toLocaleString('ja-JP'));
    const tier = element('td'); const tierContent = element('div', 'ranking-tier');
    tierContent.append(bodyIcon(record.bestTier as Tier), element('span', '', TIER_NAMES[record.bestTier])); tier.append(tierContent);
    node.append(position, name, score, tier, element('td', 'extra-column', String(record.maxChain)),
      element('td', 'extra-column', durationLabel(record.seconds)),
      element('td', 'extra-column record-date', new Date(record.playedAt).toLocaleDateString('ja-JP')));
    return node;
  }
  records.forEach((record,index) => body.append(row(record,index))); table.append(body); root.append(table);
  if (fromResult && latest !== null) {
    const target: HTMLElement = latest;
    requestAnimationFrame(() => target.scrollIntoView({block:'nearest'}));
  }
}
