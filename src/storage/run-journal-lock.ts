// localStorageの予算確認と追記を、同じoriginの別ページと順に行う。
export function withRunJournalLock<T>(name: string, work: () => T, unsaved: () => T): Promise<T> {
  let locks: LockManager | undefined;
  try { locks = typeof navigator === 'undefined' ? undefined : navigator.locks; }
  catch { return Promise.resolve(unsaved()); }
  if (!locks) return Promise.resolve(work());
  return new Promise(resolve => {
    const controller = new AbortController();
    let settled = false;
    const finish = (result: T) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => {
      if (settled) return;
      controller.abort(); finish(unsaved());
    }, 3000);
    try {
      void locks.request(name, { signal: controller.signal }, () => settled ? undefined : work())
        .then(result => { if (!settled && result !== undefined) finish(result); }, () => { if (!settled) finish(unsaved()); });
    } catch { finish(unsaved()); }
  });
}
