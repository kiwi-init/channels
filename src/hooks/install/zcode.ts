import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { omit } from "@kiwi/core/omit.ts";
import { loadConfig, updateConfig } from "../../config.ts";
import { isRecord, readJson, writeJson } from "../files.ts";
import { hookCommand, isOurHook, isOurHookCommand } from "../self.ts";

const ZCODE_STOP_MS = 30_000;

export function zcodeConfigPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.KIWI_ZCODE_DIR || join(homedir(), ".zcode", "cli"), "config.json");
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const ours = (hook: unknown): boolean => isRecord(hook) && typeof hook.command === "string" && isOurHookCommand(hook.command);

function withoutOurs(groups: unknown): unknown[] {
  return list(groups).flatMap((group) => {
    if (!isRecord(group)) return [group];
    const hooks = list(group.hooks);
    const kept = hooks.filter((h) => !ours(h));
    if (kept.length === hooks.length) return [group];
    return kept.length ? [{ ...group, hooks: kept }] : [];
  });
}

function stopGroup(): Record<string, unknown> {
  return { hooks: [{ type: "command", command: hookCommand("stop"), timeoutMs: ZCODE_STOP_MS }] };
}

function turnedOn(path: string): boolean {
  return (loadConfig().zcodeHooksTurnedOn ?? []).includes(path);
}

function noteTurnedOn(path: string, on: boolean): void {
  updateConfig((c) => {
    const rest = (c.zcodeHooksTurnedOn ?? []).filter((p) => p !== path);
    if (on) c.zcodeHooksTurnedOn = [...rest, path];
    else if (rest.length) c.zcodeHooksTurnedOn = rest;
    else delete c.zcodeHooksTurnedOn;
  });
}

function hasOurs(config: Record<string, unknown>): boolean {
  const hooks = config.hooks;
  return isRecord(hooks) && isRecord(hooks.events) && list(hooks.events.Stop).some((group) => isRecord(group) && list(group.hooks).some(ours));
}

export function installZcode(path: string): void {
  const config = readJson(path);
  const hooks = isRecord(config.hooks) ? config.hooks : {};
  if (hooks.enabled === false) throw new Error(`ZCode's hooks are off in ${path} (hooks.enabled is false): turn them on, then run kiwi hooks install zcode`);
  const events = isRecord(hooks.events) ? hooks.events : {};
  if (hooks.enabled === undefined) noteTurnedOn(path, true);
  writeJson(path, { ...config, hooks: { ...hooks, enabled: true, events: { ...events, Stop: [...withoutOurs(events.Stop), stopGroup()] } } });
}

export function uninstallZcode(path: string): void {
  const kiwiOn = turnedOn(path);
  if (kiwiOn) noteTurnedOn(path, false);
  if (!existsSync(path)) return;
  const config = readJson(path);
  if (!isRecord(config.hooks) || !hasOurs(config)) return;
  const events = isRecord(config.hooks.events) ? config.hooks.events : {};
  const stop = withoutOurs(events.Stop);
  const keptEvents = stop.length ? { ...events, Stop: stop } : omit(events, "Stop");
  const withEvents = Object.keys(keptEvents).length ? { ...config.hooks, events: keptEvents } : omit(config.hooks, "events");
  const hooks = kiwiOn ? omit(withEvents, "enabled") : withEvents;
  const rest = Object.keys(hooks).length ? { ...config, hooks } : omit(config, "hooks");
  if (!Object.keys(rest).length) {
    rmSync(path, { force: true });
    return;
  }
  writeJson(path, rest);
}

export function zcodeInstalled(path: string): boolean {
  if (!existsSync(path)) return false;
  const hooks = readJson(path).hooks;
  if (!isRecord(hooks) || hooks.enabled === false || !isRecord(hooks.events)) return false;
  return list(hooks.events.Stop).some((group) => isRecord(group) && list(group.hooks).some((h) => isRecord(h) && isOurHook(h.command, "stop")));
}
