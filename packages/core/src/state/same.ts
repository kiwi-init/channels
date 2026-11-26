export const quietValues = <K, V>(map: ReadonlyMap<K, V>): MapIterator<V> => Map.prototype.values.call(map) as MapIterator<V>;

export const quietEntries = <K, V>(map: ReadonlyMap<K, V>): MapIterator<[K, V]> => Map.prototype.entries.call(map) as MapIterator<[K, V]>;

export type Leaf = (a: object, b: object) => boolean | undefined;

const plain = (x: object): boolean => {
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null || proto === Array.prototype;
};

export function same(a: unknown, b: unknown, leaf?: Leaf): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  const told = leaf?.(a, b);
  if (told !== undefined) return told;
  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    const bs = [...quietEntries(b)];
    let i = 0;
    for (const [k, v] of quietEntries(a)) {
      const [bk, bv] = bs[i++]!;
      if (!same(k, bk, leaf) || !same(v, bv, leaf)) return false;
    }
    return true;
  }
  if (a instanceof Set) {
    if (!(b instanceof Set) || a.size !== b.size) return false;
    const bs = [...b];
    let i = 0;
    for (const v of a) if (!same(v, bs[i++], leaf)) return false;
    return true;
  }
  if (!plain(a) || !plain(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.hasOwn(b, k)) return false;
    if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], leaf)) return false;
  }
  return true;
}
