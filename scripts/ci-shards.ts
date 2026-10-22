export interface Timings {
  version: 1;
  files: Record<string, number>;
}

export function share(list: readonly string[], i: number, n: number, ms: Record<string, number>): string[] {
  const known = Object.values(ms);
  const guess = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const weight = (f: string) => ms[f] ?? guess;
  const loads = Array.from({ length: n }, () => ({ ms: 0, files: [] as string[] }));
  for (const f of [...list].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const least = loads.reduce((x, y) => (y.ms < x.ms ? y : x));
    least.files.push(f);
    least.ms += weight(f);
  }
  return loads[i - 1]!.files.sort();
}
