export type Wire = null | boolean | number | string | Wire[] | { [k: string]: Wire };

const isPlain = (v: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export function toWire(v: unknown): Wire {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(toWire);
  if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [toWire(k), toWire(x)]) };
  if (v instanceof Set) return { $set: [...v].map(toWire) };
  if (typeof v === "object" && isPlain(v)) {
    const out: { [k: string]: Wire } = {};
    for (const [k, x] of Object.entries(v))
      if (x !== undefined)
        out[k === "$map" || k === "$set" || k.startsWith("$$") ? `$$${k}` : k] = toWire(x);
    return out;
  }
  return null;
}

export function fromWire(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(fromWire);
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 1 && keys[0] === "$map" && Array.isArray(o.$map))
    return new Map(
      o.$map.map((e) =>
        Array.isArray(e) ? [fromWire(e[0]), fromWire(e[1])] : [undefined, undefined],
      ),
    );
  if (keys.length === 1 && keys[0] === "$set" && Array.isArray(o.$set))
    return new Set(o.$set.map(fromWire));
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k.startsWith("$$") ? k.slice(2) : k] = fromWire(o[k]);
  return out;
}
