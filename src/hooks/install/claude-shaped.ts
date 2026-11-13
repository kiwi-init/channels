import { existsSync, rmSync } from "node:fs";
import type { NamedHookHarness } from "../../seats.ts";
import { isRecord, readJson, writeJson } from "../files.ts";
import { hookCommand, isOurHook, isOurHookCommand } from "../self.ts";

export type HookEntry = { matcher?: string; hooks: { type: "command"; command: string; timeout?: number; async?: boolean; asyncRewake?: boolean }[] };
export type Settings = { hooks?: Record<string, HookEntry[]> } & Record<string, unknown>;

function withoutOurs(entries: HookEntry[] | undefined): HookEntry[] {
  return (entries ?? []).map((e) => ({ ...e, hooks: e.hooks.filter((h) => !isOurHookCommand(h.command)) })).filter((e) => e.hooks.length > 0);
}

export const ourHook = (hook: unknown): boolean => isRecord(hook) && typeof hook.command === "string" && isOurHookCommand(hook.command);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function withoutOursKeepingForeign(groups: unknown): unknown[] {
  return list(groups).flatMap((group) => {
    if (!isRecord(group)) return [group];
    const hooks = list(group.hooks);
    const kept = hooks.filter((h) => !ourHook(h));
    if (kept.length === hooks.length) return [group];
    return kept.length ? [{ ...group, hooks: kept }] : [];
  });
}

export function replaceOurs(s: Settings, event: string, ...entries: HookEntry[]): void {
  s.hooks ??= {};
  s.hooks[event] = [...withoutOurs(s.hooks[event]), ...entries];
}

export function stripOurs(s: Settings): void {
  for (const event of Object.keys(s.hooks ?? {})) {
    const kept = withoutOurs(s.hooks![event]);
    if (kept.length) s.hooks![event] = kept;
    else delete s.hooks![event];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
}

export function installClaudeShaped(path: string, harness: NamedHookHarness, events: Record<string, string>, timeoutFor: (event: string) => number, matcher?: string): void {
  const s = readJson(path) as Settings;
  for (const [event, arg] of Object.entries(events)) {
    replaceOurs(s, event, { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: hookCommand(arg, harness), timeout: timeoutFor(event) }] });
  }
  writeJson(path, s);
}

export function stripClaudeShaped(path: string): void {
  if (!existsSync(path)) return;
  const s = readJson(path) as Settings;
  stripOurs(s);
  if (!Object.keys(s).length) {
    rmSync(path, { force: true });
    return;
  }
  writeJson(path, s);
}

export function claudeShapedInstalled(path: string, harness: NamedHookHarness, events: Record<string, string>): boolean {
  if (!existsSync(path)) return false;
  const s = readJson(path) as Settings;
  return Object.entries(events).every(([event, arg]) => s.hooks?.[event]?.some((x) => x.hooks.some((h) => isOurHook(h.command, arg, harness))));
}
