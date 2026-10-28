import path from "node:path";

const KINDS = new Set([".md", ".jsonl"]);
export const MAX_SAVE_BYTES = 64 * 1024 * 1024;

export function savedName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f/\\:]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const ext = path.extname(clean).toLowerCase();
  if (!KINDS.has(ext)) throw new Error("only .md and .jsonl files are saved");
  const base = clean
    .slice(0, clean.length - ext.length)
    .replace(/^[.\s]+/u, "")
    .trim()
    .slice(0, 120);
  if (!base) throw new Error("a saved file needs a name");
  return `${base}${ext}`;
}

export function freePath(dir: string, name: string, taken: (file: string) => boolean): string {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const file = path.join(dir, n === 1 ? name : `${base} (${n})${ext}`);
    if (!taken(file)) return file;
  }
  throw new Error(`too many files named ${name} in ${dir}`);
}
