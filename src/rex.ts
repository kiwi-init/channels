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

function rexBinary(): string | null {
  return Bun.which("rex") ?? macBinary();
}

function run(bin: string, argv: string[], timeout = 3_000): { status: number | null; stdout: string } {
  const r = spawnSync(bin, argv, { encoding: "utf8", timeout });
  return { status: r.status, stdout: typeof r.stdout === "string" ? r.stdout : "" };
}

export function rexStatus(): RexStatus {
  const bin = rexBinary();
  if (!bin) return { found: false, server: "stopped" };
  const version = run(bin, ["--version"], 2_000).stdout.trim().split("\n")[0]?.trim();
  const who = run(bin, ["--autostart=false", "whoami"], 3_000);
  return { found: true, ...(version ? { version } : {}), server: who.status === 0 ? "running" : "stopped" };
}

function rexCall(place: RexPlace, method: string, args: Record<string, unknown>, timeout = 3_000): unknown {
  const bin = rexBinary();
  if (!bin) return null;
  const r = run(bin, ["-S", place.server, "api", "call", "-s", place.session, `com.superlogical.terminal.${method}`, JSON.stringify({ block_id: place.block, args })], timeout);
  if (r.status !== 0 || !r.stdout.trim()) return null;
  try {
    return JSON.parse(r.stdout) as unknown;
  } catch {
    return null;
  }
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

export function rexRootState(place: RexPlace): string | null {
  const record = rootRecord(rexCall(place, "program_status", {}));
  const state = record?.state;
  return typeof state === "string" ? state.toLowerCase() : null;
}

export function rexForeground(place: RexPlace): number | null {
  const got = rexCall(place, "process", {});
  const pid = nested(got, "foreground", "pid") ?? nested(got, "process", "foreground", "pid") ?? nested(got, "result", "foreground", "pid");
  const n = Number(pid);
  return Number.isInteger(n) && n > 0 ? n : null;
}
