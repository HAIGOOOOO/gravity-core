import { createRunStore, type RunBundle } from '../storage';
import type { RecordSample } from './records.worker';

const store = createRunStore();
const node = (id: string) => document.getElementById(id)!;
const save = node('record-save') as HTMLButtonElement;
const status = node('record-save-status');
let selected: RunBundle | null = null;

function render(): void {
  const archive = store.load();
  node('record-history-count').textContent = `履歴は全${archive.runs.length}件。新しい順に最大20件を表示します。`;
  const list = node('record-history-list');
  list.replaceChildren();
  for (const summary of archive.runs.slice(-20).reverse()) {
    const entry = store.get(summary.id);
    if (!entry) continue;
    const item = document.createElement('li');
    const description = document.createElement('p');
    description.textContent = `${entry.sample ? '自動の見本' : '保存されたプレイ'} ／ ${entry.detail.score.toLocaleString('ja-JP')}点 ／ ${new Date(entry.detail.playedAt).toLocaleString('ja-JP')}`;
    item.append(description);
    const code = store.share(entry.id);
    if (!entry.replay) {
      const note = document.createElement('p'); note.textContent = '再生なし'; item.append(note);
    }
    if (code) {
      const link = document.createElement('a');
      link.href = `./replay.html#code=${code}${entry.sample ? '&sample=1' : ''}`;
      link.target = '_blank'; link.rel = 'noopener';
      link.textContent = '保存したプレイを別タブで再生'; item.append(link);
    } else {
      const note = document.createElement('p'); note.textContent = '共有リンクなし'; item.append(note);
    }
    list.append(item);
  }
}

save.addEventListener('click', () => {
  if (!selected) return;
  const result = store.add(selected);
  status.textContent = !result.ok ? '見本を保存できませんでした。'
    : result.persisted ? '自動の見本をこの端末に保存しました。'
      : '端末には保存できないため、このページを開いている間だけ保持します。';
  render();
});

export function select(sample: RecordSample): void {
  const detail = { ...sample.detail, id: crypto.randomUUID() };
  const { id, score, bestTier, maxChain, seconds, launches, merges, supernovas, seed, playedAt, gameVersion } = detail;
  selected = {
    detail, record: { id, name: '自動の見本', score, bestTier, maxChain, seconds, launches, merges, supernovas, seed, playedAt, gameVersion },
    replay: sample.record, sample: true,
  };
  save.disabled = false;
  status.textContent = '選んだ自動の見本は、保存ボタンを押すまで履歴に追加されません。';
}

render();
