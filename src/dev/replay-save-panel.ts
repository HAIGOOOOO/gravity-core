import { parseReplay, serializeReplay, type ReplayPlayer, type ReplayRecord } from '../replay';
import { TICK_HZ } from '../game/constants';

type Saved = { name: string; record: ReplayRecord };
const KEY = 'gravity-core.replay-demo.v1';
const BACKUP_KEY = `${KEY}.previous`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
function parse(text: string): Saved | null {
  if (text.length > 1024 * 1024) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw === 'object' && raw !== null && 'record' in raw && typeof raw.record === 'string') {
      const record = parseReplay(raw.record);
      return record ? { record, name: 'name' in raw && typeof raw.name === 'string' ? raw.name.slice(0, 120) : '保存したプレイ' } : null;
    }
  } catch { return null; }
  const record = parseReplay(text);
  return record ? { record, name: '記録したプレイ' } : null;
}
function describe(saved: Saved): string {
  const seconds = Math.floor(saved.record.endTick / TICK_HZ);
  const date = new Date(saved.record.createdAt).toLocaleString('ja-JP');
  return `${saved.name} ／ ${Math.floor(seconds / 60)}分${seconds % 60}秒 ／ 記録日時 ${date}`;
}

export function createReplaySavePanel(deps: {
  getPlayer(): ReplayPlayer | null;
  openRecord(record: ReplayRecord, name: string): Promise<boolean>;
}) {
  let previous: string | null | undefined;
  try {
    const backup = localStorage.getItem(BACKUP_KEY);
    if (backup !== null) {
      const value: unknown = JSON.parse(backup);
      if (value === null || typeof value === 'string') previous = value;
    }
  } catch { /* 保存を使えない時も再生は続ける。 */ }
  const saveNotice = element('save-notice');
  const importNotice = element('import-notice');
  const text = element<HTMLTextAreaElement>('record-text');
  function add(parent: string, label: string, action: () => void): HTMLButtonElement {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', action); element(parent).append(b); return b;
  }
  const current = (): Saved | null => {
    const player = deps.getPlayer();
    return player ? { record: player.record, name: element('sample-name').textContent ?? 'プレイ' } : null;
  };
  function refreshSaved(): void {
    try {
      const raw = localStorage.getItem(KEY);
      const saved = raw ? parse(raw) : null;
      element('saved-record').textContent = saved ? `保存済み：${describe(saved)}` : raw ? '保存がありますが、この形式は読み込めません。' : '保存された記録はありません。';
      load.disabled = !saved;
    } catch { element('saved-record').textContent = 'この端末では保存を利用できません。'; load.disabled = true; }
    undo.disabled = previous === undefined;
  }
  add('save-controls', '表示中のプレイを保存', () => {
    const saved = current(); if (!saved) return;
    const record = serializeReplay(saved.record);
    if (!record) { saveNotice.textContent = 'この操作の記録は保存できません。元の保存は残っています。'; return; }
    try {
      const old = localStorage.getItem(KEY);
      const oldBackup = localStorage.getItem(BACKUP_KEY);
      localStorage.setItem(BACKUP_KEY, JSON.stringify(old));
      try { localStorage.setItem(KEY, JSON.stringify({ name: saved.name, record })); }
      catch (error) {
        if (oldBackup === null) localStorage.removeItem(BACKUP_KEY); else localStorage.setItem(BACKUP_KEY, oldBackup);
        throw error;
      }
      previous = old;
      saveNotice.textContent = `${saved.name}を保存しました。${old ? '前の保存を置き換えました。直前の保存は取り消せます。' : ''}`;
      refreshSaved();
    } catch { saveNotice.textContent = '端末に保存できませんでした。記録のコピーかファイル保存をご利用ください。'; }
  });
  const load = add('save-controls', '保存済みのプレイを開く', () => { void (async () => {
    try {
      const raw = localStorage.getItem(KEY);
      const saved = raw ? parse(raw) : null;
      if (!saved) { saveNotice.textContent = '開ける記録がありません。'; refreshSaved(); return; }
      const opened = await deps.openRecord(saved.record, saved.name);
      saveNotice.textContent = opened ? `${describe(saved)}を開きました。` : '今のルールでは、この保存を再生できません。';
      see.hidden = !opened;
    } catch { saveNotice.textContent = '保存した記録を読み込めませんでした。'; }
  })(); });
  const undo = add('save-controls', '直前の保存を取り消す', () => {
    if (previous === undefined) return;
    try {
      if (previous === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, previous);
      localStorage.removeItem(BACKUP_KEY);
      previous = undefined; saveNotice.textContent = '直前の保存を取り消し、前の状態に戻しました。'; refreshSaved();
    } catch { saveNotice.textContent = '保存を元に戻せませんでした。'; }
  });
  function exported(): string | null {
    const saved = current(); if (!saved) return null;
    const record = serializeReplay(saved.record);
    return record ? JSON.stringify({ name: saved.name, record }) : null;
  }
  add('export-controls', '表示中の記録をコピー', () => { void (async () => {
    const value = exported(); if (!value) return;
    try { await navigator.clipboard.writeText(value); element('export-notice').textContent = '記録をコピーしました。'; }
    catch { element('export-notice').textContent = 'コピーできませんでした。ファイルに保存する方法をご利用ください。'; }
  })(); });
  add('export-controls', '記録をファイルに保存', () => {
    const value = exported(); if (!value) return;
    const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
    const stamp = current()!.record.createdAt.replace(/[:.]/g, '-');
    const a = document.createElement('a'); a.href = url; a.download = `gravity-core-${stamp}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    element('export-notice').textContent = '記録のファイルを作成しました。';
  });
  async function importSaved(saved: Saved | null): Promise<void> {
    if (!saved) { importNotice.textContent = '記録を読み取れません。コピーした全文を貼ってください。'; return; }
    const opened = await deps.openRecord(saved.record, saved.name);
    let alreadySaved = false;
    try {
      const raw = localStorage.getItem(KEY);
      const stored = raw ? parse(raw) : null;
      alreadySaved = stored !== null && serializeReplay(stored.record) === serializeReplay(saved.record);
    } catch { /* 保存の有無が読めなくても読み込んだ盤面は表示できる。 */ }
    importNotice.textContent = opened
      ? alreadySaved ? '記録を開きました。同じ記録がこの端末に保存済みです。' : '記録を開きました。この端末にはまだ保存していません。残す場合は「表示中のプレイを保存」を押してください。'
      : 'この記録は再生できません。ルールの版や元の記録を確認してください。';
    see.hidden = !opened;
    if (opened) text.value = '';
  }
  element('import-record').addEventListener('click', () => { void importSaved(parse(text.value)); });
  text.addEventListener('input', () => { importNotice.textContent = ''; });
  element<HTMLInputElement>('record-file').addEventListener('change', (event) => { void (async () => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { importNotice.textContent = '記録のファイルが大きすぎます（上限1MB）。'; return; }
    try { await importSaved(parse(await file.text())); }
    catch { importNotice.textContent = 'ファイルを読み込めませんでした。'; }
    (event.target as HTMLInputElement).value = '';
  })(); });
  const see = add('import-controls', '開いたプレイを見る', () => canvasScroll());
  function canvasScroll(): void { element('sample-name').scrollIntoView({ block: 'start' }); }
  see.hidden = true;
  refreshSaved();
  return {
    refresh() {
      const saved = current(); if (!saved) return;
      const bytes = new TextEncoder().encode(JSON.stringify({ name: saved.name, record: serializeReplay(saved.record) })).length;
      element('record-size').textContent = `表示中：${describe(saved)}。名前を含む保存サイズ ${(bytes / 1024).toFixed(2)} KB`;
    },
  };
}
