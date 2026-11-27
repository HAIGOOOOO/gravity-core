import './history-demo.css';
import { TIER_NAMES } from '../game/constants';
import { rulesVersion } from '../replay';
import type { RunStore, SavedRunEntry } from '../storage';
import type { RecordSample } from './records.worker';
import { historySamples } from './history-samples';

type View = 'recent' | 'days' | 'focus';
const PAGE_SIZE = 20;
const node = (id: string) => document.getElementById(id)!;
const content = node('history-content');
const status = node('history-status');
const region = node('history-region');
const previous = node('history-previous') as HTMLButtonElement;
const next = node('history-next') as HTMLButtonElement;
let store: RunStore | null = null;
let view: View = 'recent', scenario = 'normal', page = 0, renderNumber = 0;
let selectedId: string | null = null;
const date = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' });
const shortDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
const time = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag); item.textContent = text; item.className = className; return item;
}
function details(entry: SavedRunEntry): HTMLDetailsElement {
  const item = element('details'); item.append(element('summary', '詳しい記録'));
  const list = element('dl');
  for (const [label, value] of [
    ['投げた回数', `${entry.detail.launches}投`], ['合体', `${entry.detail.merges}回`],
    ['着地', entry.detail.lands === null ? '不明' : `${entry.detail.lands}回`],
    ['限界を超えた時間', entry.detail.overLimitSeconds === null ? '不明' : `${entry.detail.overLimitSeconds.toFixed(1)}秒`],
  ]) { list.append(element('dt', label), element('dd', value)); }
  item.append(list); return item;
}
function replayEntry(entry: SavedRunEntry): HTMLElement {
  if (!entry.replay) return element('p', '再生なし（得点と記録は残っています）', 'replay-note');
  const replay = store!.replay(entry.id);
  if (!replay || replay.rulesVersion !== rulesVersion()) return element('p', '現在のルールでは再生できません', 'replay-note');
  const code = store!.share(entry.id);
  if (!code) return element('p', 'この見本ページでは再生できません', 'replay-note');
  const link = element('a', 'このプレイを再生', 'replay-link');
  link.href = `./replay.html#code=${code}&sample=1`; link.target = '_blank'; link.rel = 'noopener';
  link.setAttribute('aria-label', `${date.format(new Date(entry.detail.playedAt))} ${time.format(new Date(entry.detail.playedAt))}、${entry.detail.score.toLocaleString('ja-JP')}点のプレイを再生（別タブ）`);
  return link;
}
function row(entry: SavedRunEntry, withDate = true): HTMLElement {
  const item = element('article', '', 'history-row'); item.dataset.id = entry.id;
  item.tabIndex = -1;
  const stamp = new Date(entry.detail.playedAt);
  const when = element('time', `${withDate ? date.format(stamp) + '　' : ''}${time.format(stamp)}`, 'when');
  when.dateTime = entry.detail.playedAt;
  const line = element('div', '', 'row-main');
  const score = element('h3', entry.detail.score.toLocaleString('ja-JP'), 'score'); score.append(element('span', ' 点'));
  line.append(score, replayEntry(entry));
  item.append(when, line, element('p', `${TIER_NAMES[entry.detail.bestTier]}まで　${entry.detail.maxChain}連鎖　${clock(entry.detail.seconds)}`, 'run-summary'), details(entry));
  return item;
}
async function render(focusId?: string): Promise<void> {
  const current = ++renderNumber;
  region.setAttribute('aria-busy', 'true');
  if (!store) return;
  await store.ready();
  if (current !== renderNumber) return;
  const entries = [...store.load().runs].reverse();
  page = Math.min(page, Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1));
  content.replaceChildren();
  node('history-heading').textContent = view === 'recent' ? '新しい順' : view === 'days' ? '日ごとの記録' : '選んだプレイ';
  node('proposal-note').textContent = view === 'recent' ? 'A案：直前のプレイから見返す。'
    : view === 'days' ? 'B案：遊んだ日を手がかりに探す。' : 'C案：1件を選んで、記録と再生をまとめて見る。';
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.view === view && scenario === 'normal'));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.state === scenario)));
  if (scenario !== 'normal') {
    status.textContent = scenario === 'empty' ? 'まだ記録はありません。' : '記録を読み取れません。元の保存は変更しません。';
    content.append(element('p', scenario === 'empty' ? '得点と詳しい記録を、あとから見返せます。' : 'これは保存を読めない場合の表示例です。一覧に戻ると見本を表示できます。', 'empty-state'));
  } else {
    const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    status.textContent = `自動の見本 ${entries.length}件 ／ ${entries.length ? page * PAGE_SIZE + 1 : 0}〜${Math.min((page + 1) * PAGE_SIZE, entries.length)}件`;
    if (view === 'focus') {
      const selected = slice.find(entry => entry.id === selectedId) ?? slice[0];
      selectedId = selected?.id ?? null;
      const layout = element('div', '', 'focus-layout'), choices = element('div', '', 'history-choices');
      for (const entry of slice) {
        const stamp = new Date(entry.detail.playedAt);
        const button = element('button', `${shortDate.format(stamp)} ${time.format(stamp)}　${entry.detail.score.toLocaleString('ja-JP')}点`);
        button.type = 'button'; button.dataset.select = entry.id;
        button.setAttribute('aria-pressed', String(entry.id === selectedId));
        button.setAttribute('aria-label', `${date.format(stamp)} ${time.format(stamp)} ${entry.detail.score.toLocaleString('ja-JP')}点の記録を選ぶ`);
        button.addEventListener('click', () => { selectedId = entry.id; void render(entry.id); }); choices.append(button);
      }
      layout.append(choices); if (selected) layout.append(row(selected)); content.append(layout);
    } else if (view === 'days') {
      let group: HTMLElement | null = null, last = '';
      for (const entry of slice) {
        const day = date.format(new Date(entry.detail.playedAt));
        if (day !== last) { group = element('section', '', 'day-group'); group.append(element('h3', day, 'day-heading')); content.append(group); last = day; }
        group!.append(row(entry, false));
      }
    } else for (const entry of slice) content.append(row(entry));
  }
  node('history-pages').hidden = scenario !== 'normal' || entries.length <= PAGE_SIZE;
  previous.disabled = page === 0; next.disabled = (page + 1) * PAGE_SIZE >= entries.length;
  node('history-page').textContent = `${page + 1} / ${Math.max(1, Math.ceil(entries.length / PAGE_SIZE))}`;
  region.setAttribute('aria-busy', 'false');
  if (focusId) {
    const selected = content.querySelector<HTMLElement>('.history-row');
    selected?.focus({ preventScroll: true }); selected?.scrollIntoView({ block: 'nearest' });
  }
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  view = button.dataset.view as View; scenario = 'normal'; page = 0; void render();
}));
document.querySelectorAll<HTMLButtonElement>('[data-state]').forEach(button => button.addEventListener('click', () => {
  scenario = button.dataset.state!; void render();
}));
async function turnPage(direction: number): Promise<void> {
  page += direction; await render();
  node('history-heading').focus({ preventScroll: true }); region.scrollIntoView({ block: 'start' });
}
previous.addEventListener('click', () => { void turnPage(-1); });
next.addEventListener('click', () => { void turnPage(1); });
document.querySelector<HTMLButtonElement>('[data-reset]')!.addEventListener('click', () => { view = 'recent'; scenario = 'normal'; page = 0; void render(); });
const retry = node('history-retry') as HTMLButtonElement;
let worker: Worker | null = null, preparationTimer: number | undefined;
function stop(): void { worker?.terminate(); worker = null; window.clearTimeout(preparationTimer); }
function failed(): void {
  stop(); status.textContent = '見本を準備できませんでした。もう一度お試しください。';
  region.setAttribute('aria-busy', 'false'); retry.hidden = false;
  retry.focus({ preventScroll: true });
}
function prepare(): void {
  const returnFocus = document.activeElement === retry;
  stop(); retry.hidden = true; region.setAttribute('aria-busy', 'true');
  status.textContent = '自動の見本を準備しています。';
  document.querySelectorAll<HTMLButtonElement>('#demo-controls button').forEach(button => { button.disabled = true; });
  try {
    const current = new Worker(new URL('./records.worker.ts', import.meta.url), { type: 'module' });
    worker = current;
    preparationTimer = window.setTimeout(failed, 5000);
    current.onmessage = (event: MessageEvent<RecordSample>) => {
      if (worker !== current) return;
      try {
        const count = new URLSearchParams(location.search).get('count') === '1000' ? 1000 : 6;
        store = historySamples(event.data, count); stop();
        document.querySelectorAll<HTMLButtonElement>('#demo-controls button').forEach(button => { button.disabled = false; });
        void render().then(() => {
          if (returnFocus) { node('history-heading').focus({ preventScroll: true }); region.scrollIntoView({ block: 'nearest' }); }
        });
      } catch { failed(); }
    };
    current.onerror = current.onmessageerror = failed;
    current.postMessage(30);
  } catch { failed(); }
}
retry.addEventListener('click', prepare);
prepare();
window.addEventListener('pagehide', stop);
