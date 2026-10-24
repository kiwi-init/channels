import type { RexPlace, RexStatus } from "@kiwi/core/terminals.ts";
import type { RexActivity } from "../plugin.ts";
import { listIn, nested, object, parseJson } from "../shared/json.ts";
import { run, runNow } from "../shared/run.ts";
import { rexBinary } from "./locate.ts";

const WHOAMI = ["--autostart=false", "whoami", "--json"];

export function rexStatus(): Omit<RexStatus, "helpers" | "rotation"> {
  const bin = rexBinary();
  if (!bin) return { found: false, server: "stopped" };
  const version = /^rex (\S+)/.exec(runNow([bin, "version"], 2_000).stdout.trim())?.[1];
  const who = runNow([bin, ...WHOAMI], 3_000);
  return { found: true, ...(version ? { version } : {}), server: who.status === 0 ? "running" : "stopped" };
}

export async function rexServer(bin: string): Promise<string | null> {
  const r = await run([bin, ...WHOAMI], 5_000);
  const endpoint = r.status === 0 ? nested(parseJson(r.stdout), "endpoint") : null;
  return typeof endpoint === "string" && endpoint ? endpoint : null;
}

export function rexApiArgv(server: string | null, method: string, args: Record<string, unknown>, session?: string): string[] {
  return [...(server ? ["-S", server] : []), "--autostart=false", "api", "call", ...(session ? ["-s", session] : []), method, JSON.stringify(args)];
}

export function rexApi(place: RexPlace, method: string, args: Record<string, unknown>, bin: string | null = rexBinary(), session = true, timeout = 5_000): unknown {
  if (!bin) return null;
  const r = runNow([bin, ...rexApiArgv(place.server, method, args, session ? place.session : undefined)], timeout);
  return r.status === 0 ? parseJson(r.stdout) : null;
}

export const REX_TERMINAL = "com.superlogical.terminal";

function blockCall(place: RexPlace, method: string, args: Record<string, unknown>, bin: string | null = rexBinary(), timeout = 5_000): unknown {
  return rexApi(place, `${REX_TERMINAL}.${method}`, { block_id: place.block, args }, bin, true, timeout);
}

function rootRecord(v: unknown): Record<string, unknown> | null {
  for (const item of listIn(v, ["records", "status", "program_status", "values"]) ?? []) {
    const record = object(item);
    if (!record) continue;
    const id = record.id;
    if (id === undefined || id === null || id === "" || id === "root" || id === "/") return record;
  }
  return object(nested(v, "root"));
}

export function rexRootState(place: RexPlace, bin: string | null = rexBinary()): string | null {
  const record = rootRecord(blockCall(place, "program_status", {}, bin));
  const state = record?.state;
  return typeof state === "string" ? state.toLowerCase() : null;
}

export function rexForeground(place: RexPlace, bin: string | null = rexBinary()): number | null {
  return rexProcess(place, bin)?.foreground ?? null;
}

export interface RexProcess {
  foreground: number | null;
  child: number | null;
}

export function rexProcess(place: RexPlace, bin: string | null = rexBinary()): RexProcess | null {
  const got = blockCall(place, "process", {}, bin);
  const fg = nested(got, "foreground", "pid") ?? nested(got, "process", "foreground", "pid") ?? nested(got, "result", "foreground", "pid");
  const child = nested(got, "child", "pid") ?? nested(got, "process", "child", "pid") ?? nested(got, "result", "child", "pid");
  const pid = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  return got === null ? null : { foreground: pid(fg), child: pid(child) };
}

export async function rexActivity(place: RexPlace, bin: string | null = rexBinary(), timeout = 5_000): Promise<RexActivity | null> {
  if (!bin) return null;
  const r = await run([bin, ...rexApiArgv(place.server, `${REX_TERMINAL}.program_status`, { block_id: place.block, args: {} }, place.session)], timeout);
  const record = rootRecord(r.status === 0 ? parseJson(r.stdout) : null);
  const state = typeof record?.state === "string" ? record.state.toLowerCase() : null;
  const msg = typeof record?.msg === "string" && record.msg ? record.msg : undefined;
  if (state === "working") return { state: "working", ...(msg ? { tool: msg } : {}) };
  if (state === "blocked") return { state: "waiting" };
  if (state === "done" || state === "idle") return { state: "idle" };
  return null;
}

export function rexInstance(place: RexPlace, bin: string | null = rexBinary()): string | null {
  const got = rexApi(place, "server.status", {}, bin, false);
  const id = nested(got, "instance_id") ?? nested(got, "instanceId") ?? nested(got, "server", "instance_id");
  return typeof id === "string" && id ? id : null;
}

export function rexScreen(place: RexPlace, bin: string | null = rexBinary()): string | null {
  const got = blockCall(place, "format", { format: "text", unwrap: true }, bin);
  if (typeof got === "string") return got;
  for (const key of ["content", "screen", "text", "vt", "data"]) {
    const v = nested(got, key);
    if (typeof v === "string") return v;
  }
  return null;
}
