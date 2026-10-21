import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RexPlace, RexStatus } from "@kiwi/core/terminals.ts";
import { listIn, nested, object, parseJson } from "./terminals/shared/json.ts";
import { run, runNow } from "./terminals/shared/run.ts";

type Env = Record<string, string | undefined>;

export interface TerminalPlace {
  program: string;
  version?: string;
}

export type { RexPlace };

export interface SeatPlace {
  term?: TerminalPlace;
  rex?: RexPlace;
}

const PROGRAM = /^[A-Za-z][A-Za-z0-9+._-]{0,31}$/;
const VERSION = /^[\x21-\x7e]{1,64}$/;
const SERVER = /^[\x21-\x7e]{1,512}$/;
export const REX_SESSION = /^session:[0-9a-f-]{36}$/;
export const REX_BLOCK = /^block:[0-9a-f-]{36}$/;

export function placeFrom(env: Env): SeatPlace {
  if (env.TMUX) return {};
  const program = env.TERM_PROGRAM?.trim();
  const version = env.TERM_PROGRAM_VERSION?.trim();
  const term = program && PROGRAM.test(program) ? { program, ...(version && VERSION.test(version) ? { version } : {}) } : undefined;
  const server = env.REX_SERVER?.trim();
  const session = env.REX_SESSION?.trim();
  const block = env.REX_BLOCK?.trim();
  const rex = program === "rex" && server && SERVER.test(server) && session && REX_SESSION.test(session) && block && REX_BLOCK.test(block) ? { server, session, block } : undefined;
  return { ...(term ? { term } : {}), ...(rex ? { rex } : {}) };
}

const STATUS_PROGRAMS = new Set(["rex"]);

export function takesStatus(term: TerminalPlace | undefined): boolean {
  return !!term && STATUS_PROGRAMS.has(term.program.toLowerCase());
}

export function aliasSegment(alias: string): string {
  return alias.replace(/[^A-Za-z0-9_.+-]/g, "").slice(0, 32) || "ch";
}

export function askId(alias: string): string {
  return `kiwi/${aliasSegment(alias)}/ask`;
}

export function reviewId(alias: string, task: number): string {
  return `kiwi/${aliasSegment(alias)}/T${task}`;
}

type StatusState = "blocked" | "done";

export interface StatusRecord {
  id: string;
  state: StatusState;
  kind?: "question";
  msg: string;
}

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
const OSC = "\x1b]7501;";
const ST = "\x1b\\";

export function statusFrame(record: StatusRecord): string {
  const fields = [`state=${record.state}`, ...(record.kind ? [`kind=${record.kind}`] : []), "app=kiwi", `id=${record.id}`, `title=${b64("Kiwi")}`, `msg=${b64(record.msg)}`];
  return `${OSC}${fields.join(":")}${ST}`;
}

export function clearFrame(id: string): string {
  return `${OSC}state=clear:app=kiwi:id=${id}${ST}`;
}

const MAC_REX = join(homedir(), "Library", "Application Support", "com.superlogical.rex", "RexServer", "Versions");

function macBinary(): string | null {
  if (process.platform !== "darwin" || !existsSync(MAC_REX)) return null;
  const versions = readdirSync(MAC_REX).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const bin = join(MAC_REX, v, "Rex Server.app", "Contents", "MacOS", "rex");
    if (existsSync(bin)) return bin;
  }
  return null;
}

export function rexBinary(): string | null {
  return Bun.which("rex") ?? macBinary();
}

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

export interface RexActivity {
  state: "working" | "waiting" | "idle";
  tool?: string;
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

function blocksIn(v: unknown): unknown[] | null {
  const list = listIn(v, ["blocks", "list", "ids", "block_ids"], true);
  if (list) return list;
  const record = object(v);
  const placed = record?.placed;
  const detached = record?.detached;
  if (Array.isArray(placed) || Array.isArray(detached)) return [...(Array.isArray(placed) ? placed : []), ...(Array.isArray(detached) ? detached : [])];
  return null;
}

export function rexBlockPresent(place: RexPlace, bin: string | null = rexBinary()): boolean | null {
  const list = blocksIn(rexApi(place, "session.list_blocks", {}, bin));
  if (!list) return null;
  return list.some((item) => {
    if (typeof item === "string") return item === place.block;
    const block = object(item);
    return block?.block_id === place.block || block?.id === place.block;
  });
}

export function rexScreen(place: RexPlace, bin: string | null = rexBinary()): string | null {
  const got = blockCall(place, "format", { format: "vt" }, bin);
  if (typeof got === "string") return got;
  for (const key of ["content", "screen", "text", "vt", "data"]) {
    const v = nested(got, key);
    if (typeof v === "string") return v;
  }
  return null;
}
