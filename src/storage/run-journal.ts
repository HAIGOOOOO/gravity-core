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
  function room(pending: RunJournalItem | null): RunJournalItem | null | false {
    for (let attempt = 0; attempt < 3; attempt++) {
      const rows = read();
      let chars = usage() + (pending ? pending.key.length + pending.raw.length : 0);
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
      }
      // 別ページが更新した原文を上書きしない。実際の合計で書込前にもう一度判定する。
      if (usage() + (pending ? pending.key.length + pending.raw.length : 0) <= MAX_RUN_JOURNAL_CHARS) return pending;
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
        const pending = room({ key, raw: JSON.stringify({ order, value }), order, value });
        if (!pending || !port.write(key, pending.raw)) return false;
        // Web Locksのない環境でも、並行追記後の合計を再確認する。
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
