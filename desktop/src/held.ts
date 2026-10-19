export function held<K, V>(ttlMs: number, get: (key: K) => Promise<V>, now: () => number = Date.now): (key: K) => Promise<V> {
  const kept = new Map<K, { at: number; value: Promise<V> }>();
  return (key) => {
    const got = kept.get(key);
    if (got && now() - got.at < ttlMs) return got.value;
    const entry = { at: now(), value: get(key) };
    kept.set(key, entry);
    entry.value.catch(() => {
      if (kept.get(key) === entry) kept.delete(key);
    });
    return entry.value;
  };
}
