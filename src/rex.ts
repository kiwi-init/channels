import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export interface TerminalPlace {
  program: string;
  version?: string;
}

export interface RexPlace {
  server: string;
  session: string;
  block: string;
}

export interface SeatPlace {
  term?: TerminalPlace;
  rex?: RexPlace;
}

const PROGRAM = /^[A-Za-z][A-Za-z0-9+._-]{0,31}$/;
const VERSION = /^[\x21-\x7e]{1,64}$/;
const SERVER = /^[\x21-\x7e]{1,512}$/;
const SESSION = /^session:[0-9a-f-]{36}$/;
const BLOCK = /^block:[0-9a-f-]{36}$/;

export function placeFrom(env: Env): SeatPlace {
  if (env.TMUX) return {};
  const program = env.TERM_PROGRAM?.trim();
  const version = env.TERM_PROGRAM_VERSION?.trim();
  const term = program && PROGRAM.test(program) ? { program, ...(version && VERSION.test(version) ? { version } : {}) } : undefined;
  const server = env.REX_SERVER?.trim();
  const session = env.REX_SESSION?.trim();
  const block = env.REX_BLOCK?.trim();
  const rex = program === "rex" && server && SERVER.test(server) && session && SESSION.test(session) && block && BLOCK.test(block) ? { server, session, block } : undefined;
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

export interface RexStatus {
  found: boolean;
  version?: string;
  server: "running" | "stopped";
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

export function runRex(bin: string, argv: string[], timeout = 5_000): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(bin, argv, { encoding: "utf8", timeout });
  return { status: r.status, stdout: typeof r.stdout === "string" ? r.stdout : "", stderr: typeof r.stderr === "string" ? r.stderr : "" };
}

function run(bin: string, argv: string[], timeout = 3_000): { status: number | null; stdout: string } {
  const r = runRex(bin, argv, timeout);
  return { status: r.status, stdout: r.stdout };
}

export function rexStatus(): RexStatus {
  const bin = rexBinary();
  if (!bin) return { found: false, server: "stopped" };
  const version = run(bin, ["--version"], 2_000).stdout.trim().split("\n")[0]?.trim();
  const who = run(bin, ["--autostart=false", "whoami"], 3_000);
  return { found: true, ...(version ? { version } : {}), server: who.status === 0 ? "running" : "stopped" };
}

function parse(stdout: string): unknown {
  if (!stdout.trim()) return null;
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

function api(place: RexPlace, method: string, args: Record<string, unknown>, bin: string | null = rexBinary(), session = true, timeout = 5_000): unknown {
  if (!bin) return null;
  const r = run(bin, ["-S", place.server, "api", "call", ...(session ? ["-s", place.session] : []), method, JSON.stringify(args)], timeout);
  return r.status === 0 ? parse(r.stdout) : null;
}

function blockCall(place: RexPlace, method: string, args: Record<string, unknown>, bin: string | null = rexBinary(), timeout = 5_000): unknown {
  return api(place, `com.superlogical.terminal.${method}`, { block_id: place.block, args }, bin, true, timeout);
}

function object(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function nested(v: unknown, ...path: string[]): unknown {
  let at: unknown = v;
  for (const key of path) {
    const o = object(at);
    if (!o) return undefined;
    at = o[key];
  }
  return at;
}

function recordsIn(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  for (const key of ["records", "status", "program_status", "values"]) {
    const list = nested(v, key);
    if (Array.isArray(list)) return list;
  }
  return [];
}

function rootRecord(v: unknown): Record<string, unknown> | null {
  for (const item of recordsIn(v)) {
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

function rexRoot(place: RexPlace, bin: string | null = rexBinary()): Record<string, unknown> | null {
  return rootRecord(blockCall(place, "program_status", {}, bin));
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

export function rexActivity(place: RexPlace, bin: string | null = rexBinary()): RexActivity | null {
  const record = rexRoot(place, bin);
  const state = typeof record?.state === "string" ? record.state.toLowerCase() : null;
  const msg = typeof record?.msg === "string" && record.msg ? record.msg : undefined;
  if (state === "working") return { state: "working", ...(msg ? { tool: msg } : {}) };
  if (state === "blocked") return { state: "waiting" };
  if (state === "done" || state === "idle") return { state: "idle" };
  return null;
}

export function rexInstance(place: RexPlace, bin: string | null = rexBinary()): string | null {
  const got = api(place, "server.status", {}, bin, false);
  const id = nested(got, "instance_id") ?? nested(got, "instanceId") ?? nested(got, "server", "instance_id");
  return typeof id === "string" && id ? id : null;
}

function listIn(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  const record = object(v);
  if (!record) return null;
  for (const key of ["blocks", "list", "ids", "block_ids"]) {
    const list = record[key];
    if (Array.isArray(list)) return list;
    const values = object(list);
    if (values) return Object.values(values);
  }
  const placed = record.placed;
  const detached = record.detached;
  if (Array.isArray(placed) || Array.isArray(detached)) return [...(Array.isArray(placed) ? placed : []), ...(Array.isArray(detached) ? detached : [])];
  return null;
}

export function rexBlockPresent(place: RexPlace, bin: string | null = rexBinary()): boolean | null {
  const list = listIn(api(place, "session.list_blocks", {}, bin));
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
