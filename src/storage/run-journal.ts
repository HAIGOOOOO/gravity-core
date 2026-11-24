// DBを開けない時だけ使う追記口。共有JSONの上書きで別タブの1件を消さない。
export const RUN_JOURNAL_PREFIX = 'gravity-core:runs:pending:';
export type RunJournalItem = Readonly<{ key: string; raw: string; order: number; value: unknown }>;
export function createRunJournal(port: {
  keys(): readonly string[];
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove?(key: string): void;
}) {
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
  return {
    read,
    append(value: unknown): boolean {
      const prior = read();
      const order = Math.max(Date.now(), (prior.at(-1)?.order ?? 0) + 1);
      const key = RUN_JOURNAL_PREFIX + crypto.randomUUID();
      return port.write(key, JSON.stringify({ order, value }));
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
