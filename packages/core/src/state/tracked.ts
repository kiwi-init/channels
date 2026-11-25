export class TrackedMap<K, V> extends Map<K, V> {
  touched = new Set<K>();
  removed = new Set<K>();
  all = false;

  override get(key: K): V | undefined {
    this.touched.add(key);
    return super.get(key);
  }

  override set(key: K, value: V): this {
    this.touched?.add(key);
    return super.set(key, value);
  }

  override delete(key: K): boolean {
    this.touched.add(key);
    this.removed.add(key);
    return super.delete(key);
  }

  override clear(): void {
    this.all = true;
    super.clear();
  }

  override values(): MapIterator<V> {
    this.all = true;
    return super.values();
  }

  override entries(): MapIterator<[K, V]> {
    this.all = true;
    return super.entries();
  }

  override forEach(fn: (value: V, key: K, map: Map<K, V>) => void, self?: unknown): void {
    this.all = true;
    super.forEach(fn, self);
  }

  override [Symbol.iterator](): MapIterator<[K, V]> {
    this.all = true;
    return super.entries();
  }

  peek(key: K): V | undefined {
    return super.get(key);
  }

  rest(): void {
    this.touched.clear();
    this.removed.clear();
    this.all = false;
  }
}

export const quietValues = <K, V>(map: ReadonlyMap<K, V>): MapIterator<V> => Map.prototype.values.call(map) as MapIterator<V>;

const quietEntries = <K, V>(map: ReadonlyMap<K, V>): MapIterator<[K, V]> => Map.prototype.entries.call(map) as MapIterator<[K, V]>;

const copied = <V>(value: V): V => (typeof value === "object" && value !== null ? structuredClone(value) : value);

export function mirrored<K, V>(draft: TrackedMap<K, V>, prev: Map<K, V> | null): Map<K, V> {
  if (!prev || draft.all) {
    const out = new Map<K, V>();
    for (const [k, v] of quietEntries(draft)) out.set(k, copied(v));
    return out;
  }
  const changed = [...draft.touched].filter((k) => draft.removed.has(k) || draft.has(k) !== prev.has(k) || !same(draft.peek(k), prev.get(k)));
  if (!changed.length) return prev;
  const out = new Map(prev);
  for (const k of changed) {
    if (!draft.has(k)) {
      out.delete(k);
      continue;
    }
    if (draft.removed.has(k)) out.delete(k);
    out.set(k, copied(draft.peek(k) as V));
  }
  return out;
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    const bs = [...quietEntries(b)];
    let i = 0;
    for (const [k, v] of quietEntries(a)) {
      const [bk, bv] = bs[i++]!;
      if (!same(k, bk) || !same(v, bv)) return false;
    }
    return true;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return false;
    const bs = [...b];
    let i = 0;
    for (const v of a) if (!same(v, bs[i++])) return false;
    return true;
  }
  if (b instanceof Map || b instanceof Set) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.hasOwn(b, k)) return false;
    if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

export function unrecorded<K, V>(draft: TrackedMap<K, V>, prev: Map<K, V>): K[] {
  if (draft.all) return [];
  const out: K[] = [];
  for (const k of new Set([...prev.keys(), ...draft.keys()])) {
    if (draft.touched.has(k)) continue;
    if (draft.has(k) !== prev.has(k) || !same(draft.peek(k), prev.get(k))) out.push(k);
  }
  return out;
}
