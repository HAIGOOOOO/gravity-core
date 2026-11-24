// DBを開けない時だけ使う追記口。共有JSONの上書きで別タブの1件を消さない。
export const RUN_JOURNAL_PREFIX = 'gravity-core:runs:pending:';
// キーも含めUTF-16約2MBまで。最高点と設定に同じ保存口の空きを残す。
export const MAX_RUN_JOURNAL_CHARS = 1_000_000;
export type RunJournalItem = Readonly<{ key: string; raw: string; order: number; value: unknown }>;
type JournalEntry = Readonly<{ id: string; replay: string | null }>;
export function createRunJournal<T extends JournalEntry>(port: {
  keys(): readonly string[];
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove?(key: string): void;
}, parse: (value: unknown) => T | null) {
  function usage(): number {
    return port.keys().filter(key => key.startsWith(RUN_JOURNAL_PREFIX))
      .reduce((sum, key) => sum + key.length + (port.read(key)?.length ?? 0), 0);
  }
  function read(): RunJournalItem[] {
    const rows: RunJournalItem[] = [];
    try {
      for (const key of port.keys()) {
        if (!key.startsWith(RUN_JOURNAL_PREFIX)) continue;
        const raw = port.read(key);
        if (!raw || raw.length > 4_000_000) continue;
        try {
          const decoded: unknown = JSON.parse(raw);
          if (typeof decoded !== 'object' || decoded === null || !('order' in decoded)
            || typeof decoded.order !== 'number' || !Number.isFinite(decoded.order) || !('value' in decoded)) continue;
          rows.push({ key, raw, order: decoded.order, value: decoded.value });
        } catch { /* 読めない原文は残す。 */ }
      }
    } catch { /* 使えない保存口でもページ内の記録は残る。 */ }
    return rows.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  }
  function remove(item: RunJournalItem): void {
    try { if (port.read(item.key) === item.raw) port.remove?.(item.key); } catch { /* 次回にも読める原文を残す。 */ }
  }
  // 壊れた原文は予算に数えるが触らない。縮小できない時は新しい保存を成功扱いにしない。
  type Compacted = { item: RunJournalItem; raw: string };
  function restore(changes: readonly Compacted[]): void {
    for (const { item, raw } of [...changes].reverse()) {
      try {
        if (port.read(item.key) === raw && usage() + item.raw.length - raw.length <= MAX_RUN_JOURNAL_CHARS) {
          port.write(item.key, item.raw);
        }
      } catch { /* 復元も拒否された場合は、保存済みの履歴を保つ。 */ }
    }
  }
  function room(pending: RunJournalItem | null, compacted?: Compacted[]): RunJournalItem | null | false {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rows = read().filter(item => item.key !== pending?.key);
      const replacing = pending ? port.read(pending.key) : null;
      let chars = usage() + (pending ? pending.raw.length - (replacing?.length ?? 0)
        + (replacing === null ? pending.key.length : 0) : 0);
      const changes = new Map<RunJournalItem, string>();
      for (const item of [...rows, ...(pending ? [pending] : [])]) {
        if (chars <= MAX_RUN_JOURNAL_CHARS) break;
        const entry = parse(item.value);
        if (!entry?.replay) continue;
        const value = { ...entry, replay: null, replayOmitted: 'capacity' };
        const raw = JSON.stringify({ order: item.order, value });
        chars -= item.raw.length - raw.length;
        if (item === pending) pending = { ...item, raw, value };
        else changes.set(item, raw);
      }
      // 再生を全て外しても入らなければ履歴は削らず、呼出元に未保存を返す。
      if (chars > MAX_RUN_JOURNAL_CHARS) return false;
      for (const [item, raw] of changes) {
        if (port.read(item.key) !== item.raw) continue;
        if (!port.write(item.key, raw)) return false;
        compacted?.push({ item, raw });
      }
      // 別ページが更新した原文を上書きしない。実際の合計で書込前にもう一度判定する。
      const current = pending ? port.read(pending.key) : null;
      if (usage() + (pending ? pending.raw.length - (current?.length ?? 0)
        + (current === null ? pending.key.length : 0) : 0) <= MAX_RUN_JOURNAL_CHARS) return pending;
    }
    return false;
  }
  return {
    read,
    append(value: T): boolean {
      try {
        const prior = read();
        const order = Math.max(Date.now(), (prior.at(-1)?.order ?? 0) + 1);
        const key = RUN_JOURNAL_PREFIX + crypto.randomUUID();
        // 新規キーが拒否される場合は、既存の再生を一切削らない。
        // 先にこの1件の履歴だけを確保し、その後に再生の予算を割り当てる。
        const summary = { ...value, replay: null, replayOmitted: 'unavailable' };
        const staged = { key, raw: JSON.stringify({ order, value: summary }), order, value: summary };
        if (!port.write(key, staged.raw)) return false;
        const compacted: Compacted[] = [];
        const pending = room({ key, raw: JSON.stringify({ order, value }), order, value }, compacted);
        if (!pending) { remove(staged); restore(compacted); return false; }
        // 再生の追加が拒否されても、先に確保した履歴は残す。
        if (!port.write(key, pending.raw)) restore(compacted);
        // 更新後の実際の合計も確認し、超過した保存を成功扱いにしない。
        if (room(null) === false) {
          const raw = port.read(key);
          if (raw !== null) remove({ ...pending, raw });
          return false;
        }
        return true;
      } catch { return false; }
    },
    acknowledge(items: readonly RunJournalItem[]) { for (const item of items) remove(item); },
    retain(items: readonly RunJournalItem[], keep: (value: unknown) => unknown | null) {
      for (const item of items) {
        const value = keep(item.value);
        if (value === null) remove(item);
        else if (JSON.stringify(value) !== JSON.stringify(item.value) && port.read(item.key) === item.raw) {
          port.write(item.key, JSON.stringify({ order: item.order, value }));
        }
      }
    },
  };
}
