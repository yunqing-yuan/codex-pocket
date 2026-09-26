// Keep one write in flight and one dirty flag, never a queue of history snapshots.
export function latestStore({ snapshot, write, onError, onSaved, defer = () => false, delay = 900 }) {
  let timer, running = null, dirty = false, last = '', generation = 0;
  async function drain() {
    while (dirty) {
      dirty = false;
      if (defer()) { timer = setTimeout(flush, delay); break; }
      const current = generation;
      try {
        const data = snapshot();
        if (!data) continue;
        const value = JSON.stringify(data);
        if (value === last) continue;
        await write(value);
        if (current === generation) { last = value; onSaved?.(); }
      } catch (error) { last = ''; onError?.(error); }
    }
  }
  const flush = () => {
    clearTimeout(timer); dirty = true;
    if (!running) running = drain().finally(() => { running = null; });
    return running;
  };
  return {
    save(immediate = false) {
      clearTimeout(timer);
      if (immediate) return flush();
      timer = setTimeout(flush, delay);
      return running || Promise.resolve();
    },
    async reset() { clearTimeout(timer); dirty = false; generation++; if (running) await running; last = ''; },
  };
}
