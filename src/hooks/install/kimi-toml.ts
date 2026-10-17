import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { omit } from "../../omit.ts";
import { isRecord, parseToml } from "../files.ts";
import { hookCommand, isOurHook, isOurHookCommand, KIMI_STOP } from "../self.ts";

const KIMI_TIMEOUT = 30;

function kimiEntry(): { event: string; command: string; timeout: number } {
  return { event: "Stop", command: hookCommand(KIMI_STOP), timeout: KIMI_TIMEOUT };
}

function kimiHooks(config: Record<string, unknown>): unknown[] {
  return Array.isArray(config.hooks) ? config.hooks : [];
}

function isOurKimiHook(h: unknown): boolean {
  return isRecord(h) && typeof h.command === "string" && isOurHookCommand(h.command);
}

const TOML_HEADER = /^\s*\[\[?[^[\]]+\]\]?\s*(#.*)?$/;
const HOOKS_HEADER = /^\s*\[\[\s*hooks\s*\]\]/;

export function withoutKimiHooks(text: string): string {
  const lines = text.split("\n");
  const starts = lines.flatMap((line, i) => (TOML_HEADER.test(line) ? [i] : []));
  const drop = new Set<number>();
  starts.forEach((start, k) => {
    if (!HOOKS_HEADER.test(lines[start] ?? "")) return;
    let end = starts[k + 1] ?? lines.length;
    while (end > start + 1 && /^\s*(#.*)?$/.test(lines[end - 1] ?? "")) end -= 1;
    let ours: boolean;
    try {
      ours = kimiHooks(parseToml(lines.slice(start, end).join("\n"))).some(isOurKimiHook);
    } catch {
      return;
    }
    if (ours) for (let i = start; i < end; i++) drop.add(i);
  });
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

export function withKimiHooks(text: string): string {
  const kept = withoutKimiHooks(text).trimEnd();
  const e = kimiEntry();
  const block = ["[[hooks]]", `event = ${JSON.stringify(e.event)}`, `command = ${JSON.stringify(e.command)}`, `timeout = ${e.timeout}`].join("\n");
  return `${kept ? `${kept}\n\n` : ""}${block}\n`;
}

function kimiExpected(config: Record<string, unknown>, add: boolean): Record<string, unknown> {
  const hooks = [...kimiHooks(config).filter((h) => !isOurKimiHook(h)), ...(add ? [kimiEntry()] : [])];
  const rest = omit(config, "hooks");
  return hooks.length ? { ...rest, hooks } : rest;
}

export function editKimiConfig(path: string, add: boolean): void {
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const stripped = withoutKimiHooks(before);
  const after = add ? withKimiHooks(before) : stripped === before ? before : stripped.trim() ? `${stripped.trimEnd()}\n` : "";
  let same = false;
  try {
    same = Bun.deepEquals(parseToml(after), kimiExpected(parseToml(before), add));
  } catch {}
  if (!same) throw new Error(`kiwi can't edit ${path} safely; ${add ? "add" : "remove"} its [[hooks]] entry for \`${hookCommand(KIMI_STOP)}\` by hand`);
  if (after === before) return;
  if (!after) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, after);
}

export function kimiConfigInstalled(path: string): boolean {
  if (!existsSync(path)) return false;
  const e = kimiEntry();
  return kimiHooks(parseToml(readFileSync(path, "utf8"))).some((h) => isRecord(h) && h.event === e.event && isOurHook(h.command, KIMI_STOP));
}
