export interface Authors {
  names: string[];
  runs: number[];
}

export function packAuthors(by: ReadonlyMap<number, string>): Authors {
  const seqs = [...by.keys()].sort((a, b) => a - b);
  const names: string[] = [];
  const index = new Map<string, number>();
  const runs: number[] = [];
  let end = 0;
  for (let i = 0; i < seqs.length;) {
    const who = by.get(seqs[i]!)!;
    let j = i;
    while (j + 1 < seqs.length && seqs[j + 1] === seqs[j]! + 1 && by.get(seqs[j + 1]!) === who) j++;
    let at = index.get(who);
    if (at === undefined) index.set(who, (at = names.push(who) - 1));
    runs.push(seqs[i]! - end, j - i + 1, at);
    end = seqs[j]!;
    i = j + 1;
  }
  return { names, runs };
}

export function unpackAuthors(a: unknown): [number, string][] | null {
  if (!a || typeof a !== "object") return null;
  const { names, runs } = a as Partial<Authors>;
  if (!Array.isArray(names) || !names.every((n) => typeof n === "string") || !Array.isArray(runs) || runs.length % 3 !== 0) return null;
  const out: [number, string][] = [];
  let end = 0;
  for (let i = 0; i < runs.length; i += 3) {
    const [gap, len, at] = [runs[i], runs[i + 1], runs[i + 2]];
    if (!Number.isSafeInteger(gap) || !Number.isSafeInteger(len) || !Number.isSafeInteger(at) || gap! < 1 || len! < 1 || at! < 0 || at! >= names.length) return null;
    const start = end + gap!;
    for (let s = start; s < start + len!; s++) out.push([s, names[at!]!]);
    end = start + len! - 1;
  }
  return out;
}
