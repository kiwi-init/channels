import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { home, safe, writePrivate } from "./paths.ts";

export interface DocWakeItem {
  key: string;
  th: string;
  block: string;
  author: string;
  text: string;
  context: string;
  selection: string | null;
  at: number;
}

const KEEP_PENDING = 200;
const KEEP_TOLD = 2_000;

const base = (channel: string, agent: string): string => join(home(), "doc-wakes", safe(channel), safe(agent));

const isItem = (x: unknown): x is DocWakeItem => {
  const d = x as Partial<DocWakeItem> | null;
  return (
    !!d &&
    typeof d.key === "string" &&
    typeof d.th === "string" &&
    typeof d.block === "string" &&
    typeof d.author === "string" &&
    typeof d.text === "string" &&
    typeof d.context === "string" &&
    (d.selection === null || typeof d.selection === "string") &&
    Number.isFinite(d.at)
  );
};

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean);
}

function append(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, `${line}\n`, { mode: 0o600 });
}

function told(channel: string, agent: string): Set<string> {
  return new Set(readLines(`${base(channel, agent)}.told`));
}

function queued(channel: string, agent: string): DocWakeItem[] {
  const out: DocWakeItem[] = [];
  for (const line of readLines(`${base(channel, agent)}.wakes`)) {
    try {
      const x: unknown = JSON.parse(line);
      if (isItem(x)) out.push(x);
    } catch {
      // A torn last line from a crash mid-write: the rest of the queue still counts.
    }
  }
  return out;
}

export function pendingDocWakes(channel: string, agent: string): DocWakeItem[] {
  const done = told(channel, agent);
  const seen = new Set<string>();
  return queued(channel, agent).filter((w) => !done.has(w.block) && !seen.has(w.block) && (seen.add(w.block), true));
}

export function addDocWake(channel: string, agent: string, w: DocWakeItem): boolean {
  const all = queued(channel, agent);
  if (told(channel, agent).has(w.block) || all.some((q) => q.block === w.block)) return false;
  const pending = pendingDocWakes(channel, agent);
  if (pending.length >= KEEP_PENDING || pending.length < all.length)
    writePrivate(
      `${base(channel, agent)}.wakes`,
      pending
        .slice(1 - KEEP_PENDING)
        .map((p) => `${JSON.stringify(p)}\n`)
        .join(""),
    );
  append(`${base(channel, agent)}.wakes`, JSON.stringify(w));
  return true;
}

export function tellDocWakes(channel: string, agent: string, blocks: readonly string[]): void {
  if (!blocks.length) return;
  const path = `${base(channel, agent)}.told`;
  const all = [...readLines(path), ...blocks];
  if (all.length > KEEP_TOLD) writePrivate(path, all.slice(-KEEP_TOLD).join("\n") + "\n");
  else append(path, blocks.join("\n"));
}

export interface DocSeenDoc {
  cut: number;
  at: Record<string, number>;
}

export interface DocSeen {
  alive: number | null;
  docs: Record<string, DocSeenDoc>;
}

const isSeenDoc = (x: unknown): x is DocSeenDoc => {
  const d = x as Partial<DocSeenDoc> | null;
  return !!d && Number.isFinite(d.cut) && !!d.at && typeof d.at === "object" && Object.values(d.at).every((n) => Number.isFinite(n));
};

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A torn file: docs are followed from now on, as for a new seat.
    return null;
  }
}

export function legacyDocSince(channel: string, agent: string): Record<string, number> {
  const x = readJson(`${base(channel, agent)}.since.json`);
  if (!x || typeof x !== "object") return {};
  return Object.fromEntries(Object.entries(x).filter((e): e is [string, number] => Number.isFinite(e[1])));
}

export function docSeen(channel: string, agent: string): DocSeen {
  const x = readJson(`${base(channel, agent)}.seen.json`) as Partial<DocSeen> | null;
  const alive = x && Number.isFinite(x.alive) ? (x.alive as number) : null;
  const docs = x?.docs && typeof x.docs === "object" ? Object.fromEntries(Object.entries(x.docs).filter((e): e is [string, DocSeenDoc] => isSeenDoc(e[1]))) : {};
  return { alive, docs };
}

export function setDocSeen(channel: string, agent: string, seen: DocSeen): void {
  writePrivate(`${base(channel, agent)}.seen.json`, JSON.stringify(seen));
}
