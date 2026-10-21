export function object(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseJson(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not one JSON value: the caller treats it as no answer.
    return null;
  }
}

export function nested(v: unknown, ...path: string[]): unknown {
  let at: unknown = v;
  for (const key of path) {
    const o = object(at);
    if (!o) return undefined;
    at = o[key];
  }
  return at;
}

export function listIn(v: unknown, keys: readonly string[], maps = false): unknown[] | null {
  if (Array.isArray(v)) return v;
  const o = object(v);
  if (!o) return null;
  for (const key of keys) {
    const list = o[key];
    if (Array.isArray(list)) return list;
    const values = maps ? object(list) : null;
    if (values) return Object.values(values);
  }
  return null;
}

export function objectsIn(v: unknown, key: string): Record<string, unknown>[] {
  return (listIn(object(v), [key]) ?? []).flatMap((item) => {
    const o = object(item);
    return o ? [o] : [];
  });
}
