import fs from "node:fs";
import path from "node:path";

export const MAX_FILE_BYTES = 64 * 1024;
const FILE = /^[^./\\][^/\\]{0,79}\.json$/u;
const WAIT_MS = 150;

export interface Skipped {
  file: string;
  why: string;
}

export const jsonFile = (file: string): boolean => FILE.test(file) && path.basename(file) === file;

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const nameOf = (file: string, raw: Record<string, unknown>): string => (typeof raw["name"] === "string" ? raw["name"].trim().slice(0, 60) : "") || file.slice(0, -".json".length);

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: readJsonFolder lists the file as skipped, with that reason.
    return undefined;
  }
}

export function readJsonFolder<T>(dir: string, of: (file: string, raw: unknown) => T | string, max: number, noun: string): { items: T[]; skipped: Skipped[] } {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // No folder yet reads as an empty one: it's made when the app starts watching.
    return { items: [], skipped: [] };
  }
  const items: T[] = [];
  const skipped: Skipped[] = [];
  for (const file of names.filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) {
    if (!jsonFile(file)) {
      skipped.push({ file, why: "has a name over 80 characters" });
      continue;
    }
    if (items.length >= max) {
      skipped.push({ file, why: `is past the first ${max} ${noun}` });
      continue;
    }
    const at = path.join(dir, file);
    let text: string;
    try {
      const stat = fs.statSync(at);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_BYTES) {
        skipped.push({ file, why: "is over 64 KB" });
        continue;
      }
      text = fs.readFileSync(at, "utf8");
    } catch {
      // A file removed or locked between the listing and the read is skipped like a bad one.
      skipped.push({ file, why: "couldn't be read" });
      continue;
    }
    const raw = parsed(text);
    const item = raw === undefined ? "isn't valid JSON" : of(file, raw);
    if (typeof item === "string") skipped.push({ file, why: item });
    else items.push(item);
  }
  return { items, skipped };
}

export function watchFolder(dir: string, changed: () => void, stopped: () => void): () => void {
  fs.mkdirSync(dir, { recursive: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher = fs.watch(dir, { persistent: false }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      changed();
    }, WAIT_MS);
  });
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    watcher.close();
  };
  watcher.on("error", () => {
    stop();
    stopped();
  });
  return stop;
}
