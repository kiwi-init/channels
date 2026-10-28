import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home } from "../config.ts";

export const LOOP_TASK_ENV = "KIWI_LOOP_TASK";

const fileOf = (alias: string, as: string): string => join(home(), "fresh", `${encodeURIComponent(alias)}~${encodeURIComponent(as)}.json`);

export function askFresh(alias: string, as: string, task: number, at = Date.now()): void {
  const file = fileOf(alias, as);
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ task, at }), { mode: 0o600 });
}

export function freshAsked(alias: string, as: string, since: number): number | null {
  try {
    const ask: unknown = JSON.parse(readFileSync(fileOf(alias, as), "utf8"));
    if (typeof ask !== "object" || ask === null || !("task" in ask) || !("at" in ask)) return null;
    const { task, at } = ask;
    return typeof task === "number" && typeof at === "number" && at >= since ? task : null;
  } catch {
    // No ask on file (or an unreadable one): the session carries on.
    return null;
  }
}

export function clearFresh(alias: string, as: string): void {
  rmSync(fileOf(alias, as), { force: true });
}
