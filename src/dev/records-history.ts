import { createRunStore, STATS_KEY, type RunBundle } from '../storage';
import { browserStorage, SAVE_KEY } from '../storage/save';
import { rulesVersion } from '../replay/record';
import type { RecordSample } from './records.worker';

const storage = browserStorage();
const prefix = 'gravity-core:records-demo:';
const store = createRunStore(storage === null ? null : {
  getItem(key) { return key === STATS_KEY || key === SAVE_KEY ? null : storage.getItem(prefix + key); },
  setItem(key, value) { storage.setItem(prefix + key, value); },
}, {
  databaseName: 'gravity-core:records-demo:runs',
  localKeys: () => storage === null ? [] : Object.keys(window.localStorage).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)),
  removeLocalKey: key => { if (storage !== null) window.localStorage.removeItem(prefix + key); },
});
const node = (id: string) => document.getElementById(id)!;
const save = node('record-save') as HTMLButtonElement;
const status = node('record-save-status');
let selected: RunBundle | null = null;
let page = 0;
let saving = false;
let renderNumber = 0;
const previous = document.createElement('button');
previous.type = 'button'; previous.textContent = '前の20件';
const next = document.createElement('button');
next.type = 'button'; next.textContent = '次の20件';
node('record-history-list').after(previous, next);
previous.addEventListener('click', () => { page = Math.max(0, page - 1); void render(); });
next.addEventListener('click', () => { page++; void render(); });

async function render(): Promise<void> {
  const current = ++renderNumber;
  await store.ready();
  if (current !== renderNumber) return;
  const archive = store.load();
  const state = store.status();
  page = Math.min(page, Math.max(0, Math.ceil(archive.runs.length / 20) - 1));
  previous.disabled = page === 0;
  next.disabled = (page + 1) * 20 >= archive.runs.length;
  node('record-history-state').textContent = state === 'future' ? '新しい版の保存があり、この版では開けません'
    : state === 'recovered' ? '退避した記録を表示しています。保存ボタンを押すまで元の保存は変更しません'
      : state === 'unreadable' ? 'この端末の保存を読み取れません。このページを開いている間だけ保持します。'
        : state === 'unsaved' ? 'まだ端末に保存できていない記録があります。このページを開いている間は保持します。' : '';
  node('record-history-count').textContent = state === 'future' ? ''
    : `見本の履歴は全${archive.runs.length}件。新しい順の${archive.runs.length ? page * 20 + 1 : 0}〜${Math.min((page + 1) * 20, archive.runs.length)}件を表示します。`;
  const list = node('record-history-list');
  list.replaceChildren();
  for (const summary of [...archive.runs].reverse().slice(page * 20, (page + 1) * 20)) {
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
      const replay = store.replay(entry.id);
      const reason = !replay ? '再生が保存されていません。'
        : replay.rulesVersion !== rulesVersion() ? '現在とルールが違う記録です。'
          : replay.setup !== undefined ? '特別な開始盤面の記録は共有できません。' : '共有用の記録を作れませんでした。';
      const note = document.createElement('p'); note.textContent = `共有リンクなし：${reason}`; item.append(note);
    }
    list.append(item);
  }
}

save.addEventListener('click', async () => {
  if (!selected || saving) return;
  saving = true; save.disabled = true;
  status.textContent = '自動の見本を確かめて保存しています。';
  try {
    const result = await store.add(selected);
    status.textContent = !result.ok
      ? result.reason === 'mismatch' ? '見本の結果と再生が一致しないため、保存できませんでした。'
        : result.reason === 'tooLarge' ? '見本の記録が大きすぎるため、保存できませんでした。'
          : '見本の記録を読み取れないため、保存できませんでした。'
      : result.persisted ? '自動の見本をこの端末の見本用履歴に保存しました。'
        : '端末には保存できないため、このページを開いている間だけ保持します。';
    page = 0; await render();
  } catch {
    status.textContent = '見本を保存できませんでした。もう一度お試しください。';
  } finally {
    saving = false; save.disabled = selected === null;
  }
});

export function select(sample: RecordSample): void {
  const detail = { ...sample.detail, id: crypto.randomUUID() };
  const { id, score, bestTier, maxChain, seconds, launches, merges, supernovas, seed, playedAt, gameVersion } = detail;
  selected = {
    detail, record: { id, name: '自動の見本', score, bestTier, maxChain, seconds, launches, merges, supernovas, seed, playedAt, gameVersion },
    replay: sample.record, final: sample.snapshot, sample: true,
  };
  save.disabled = saving;
  status.textContent = '選んだ自動の見本は、保存ボタンを押すまで履歴に追加されません。';
}

void render();
