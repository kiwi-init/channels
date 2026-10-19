// What an agent's harness says about it on this machine, read the way a command the agent runs can:
// which model it runs on, and what it's doing right now (working, and with which tool; waiting; idle).
// Each harness keeps that somewhere local (none puts it in the environment), and kiwi reads only those
// fields: never a prompt, a reply, or a tool's input or output. Only the tool's name leaves the machine.
//
//   Claude Code  CLAUDE_CODE_SESSION_ID (or ~/.claude/sessions/$CLAUDE_PID.json), then the newest
//                assistant line's message.model in ~/.claude/projects/*/<session>.jsonl
//   Codex        CODEX_THREAD_ID, then threads.model in $CODEX_HOME/state_*.sqlite, else the
//                model its config.toml starts sessions with
//   OpenCode     OPENCODE_SESSION_ID, then session_v2.model ({id, providerID}) in opencode.db
//   Grok Build   GROK_SESSION_ID, then summary.json's model under ~/.grok/sessions/*/<session>/
//
// These are each harness's own files, not a published contract: every read is version-tolerant and
// fails soft (undefined), and `kiwi join --model` always says it instead.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

import { kimiCodePid, mimoHere, piHere, type ProcessTree } from "./ancestry.ts";
import type { Activity } from "@kiwi/core/protocol.ts";

type Env = Record<string, string | undefined>;

/** A model id worth showing: a short single token, not a placeholder like "<synthetic>". */
function slug(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s && s.length <= 120 && !s.startsWith("<") && !/\s/.test(s) ? s : undefined;
}

/** The last `bytes` of a file, as lines, newest first. */
function tailLines(file: string, bytes = 512 * 1024): string[] {
  const size = statSync(file).size;
  const len = Math.min(size, bytes);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, len, size - len);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf8").split("\n").reverse();
}

function claudeModel(env: Env): string | undefined {
  const dir = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  let session = env.CLAUDE_CODE_SESSION_ID;
  if (!session && env.CLAUDE_PID) {
    const reg = join(dir, "sessions", `${Number(env.CLAUDE_PID)}.json`);
    if (existsSync(reg)) session = (JSON.parse(readFileSync(reg, "utf8")) as { sessionId?: string }).sessionId;
  }
  if (!session || !/^[\w-]+$/.test(session)) return undefined;
  const projects = join(dir, "projects");
  for (const p of readdirSync(projects)) {
    const file = join(projects, p, `${session}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of tailLines(file)) {
      // Only assistant lines carry the model; nothing else on the line is read.
      if (!line.includes('"assistant"') || !line.includes('"model"')) continue;
      try {
        const m = slug((JSON.parse(line) as { type?: string; message?: { model?: unknown } }).message?.model);
        if (m) return m;
      } catch {
        // A line cut by the tail's start: older lines may still have it.
      }
    }
  }
  return undefined;
}

async function sqliteOne(file: string, sql: string, arg: string): Promise<unknown> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(file, { readonly: true });
  try {
    return (db.query(sql).get(arg) as Record<string, unknown> | null) ?? null;
  } finally {
    db.close();
  }
}

async function codexModel(env: Env): Promise<string | undefined> {
  const thread = env.CODEX_THREAD_ID;
  if (!thread) return undefined;
  const home = env.CODEX_HOME || join(homedir(), ".codex");
  // The index is versioned in its name (state_5.sqlite): take the newest there is.
  const dbs = readdirSync(home)
    .filter((f) => /^state_\d+\.sqlite$/.test(f))
    .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  for (const f of dbs) {
    // A table this Codex doesn't have: try the next index, then the config.
    const row = (await sqliteOne(join(home, f), "SELECT model FROM threads WHERE id = ?", thread).catch(() => null)) as { model?: unknown } | null;
    const m = slug(row?.model);
    if (m) return m;
  }
  // No index (or this thread isn't in it yet): the model its config starts sessions with.
  try {
    return slug(/^\s*model\s*=\s*"([^"]{1,80})"/m.exec(readFileSync(join(home, "config.toml"), "utf8"))?.[1]);
  } catch {
    return undefined;
  }
}

async function opencodeModel(env: Env): Promise<string | undefined> {
  const session = env.OPENCODE_SESSION_ID;
  if (!session) return undefined;
  const file = join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");
  if (!existsSync(file)) return undefined;
  const row = (await sqliteOne(file, "SELECT model FROM session_v2 WHERE id = ?", session)) as { model?: unknown } | null;
  // Stored as JSON: {"id": "claude-sonnet-4-5", "providerID": "anthropic"}.
  const raw = typeof row?.model === "string" ? (JSON.parse(row.model) as { id?: unknown }) : (row?.model as { id?: unknown } | undefined);
  return slug(raw?.id);
}

function grokModel(env: Env): string | undefined {
  const session = env.GROK_SESSION_ID;
  if (!session || !/^[\w-]+$/.test(session)) return undefined;
  const sessions = join(env.GROK_HOME || join(homedir(), ".grok"), "sessions");
  for (const ws of readdirSync(sessions)) {
    const file = join(sessions, ws, session, "summary.json");
    if (!existsSync(file)) continue;
    const summary = JSON.parse(readFileSync(file, "utf8")) as { current_model_id?: unknown; model?: unknown };
    const m = summary.current_model_id ?? summary.model;
    return slug(typeof m === "object" && m ? ((m as { id?: unknown; name?: unknown }).id ?? (m as { name?: unknown }).name) : m);
  }
  return undefined;
}

function kimiModel(env: Env): string | undefined {
  const toml = readFileSync(join(env.KIMI_CODE_HOME || join(homedir(), ".kimi-code"), "config.toml"), "utf8");
  const alias = tomlString(/^\s*default_model\s*=(.*)$/m.exec(toml)?.[1]);
  if (!alias) return undefined;
  const key = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keys = [`"${key}"`, `'${key}'`, ...(/^[A-Za-z0-9_-]+$/.test(alias) ? [key] : [])];
  const header = new RegExp(`^\\s*\\[\\s*models\\s*\\.\\s*(?:${keys.join("|")})\\s*\\]\\s*(?:#.*)?$`, "m").exec(toml);
  if (!header) return undefined;
  const section = toml.slice(header.index + header[0].length).split(/^\s*\[/m)[0] ?? "";
  return slug(tomlString(/^\s*model\s*=(.*)$/m.exec(section)?.[1]));
}

function tomlString(v: string | undefined): string | undefined {
  const m = v === undefined ? null : /^\s*(?:"([^"\\]{1,120})"|'([^']{1,120})')\s*(?:#.*)?$/.exec(v);
  return m ? (m[1] ?? m[2]) : undefined;
}

function realDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

async function mimoModel(env: Env, cwd: string): Promise<string | undefined> {
  const home = env.MIMOCODE_HOME && isAbsolute(env.MIMOCODE_HOME) ? join(env.MIMOCODE_HOME, "data") : join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "mimocode");
  const file = join(home, "mimocode.db");
  if (!existsSync(file)) return undefined;
  const { Database } = await import("bun:sqlite");
  const db = new Database(file, { readonly: true });
  try {
    const session = env.MIMOCODE_SESSION_ID;
    const rows = (
      session
        ? db.query("SELECT data FROM message WHERE session_id = ?1 ORDER BY time_created DESC LIMIT 20").all(session)
        : db
            .query(
              "SELECT m.data AS data FROM message m JOIN session s ON s.id = m.session_id WHERE s.directory = ?1 OR substr(?1, 1, length(s.directory) + 1) = s.directory || '/' ORDER BY m.time_created DESC LIMIT 20",
            )
            .all(realDir(cwd))
    ) as { data?: unknown }[];
    for (const row of rows) {
      if (typeof row.data !== "string") continue;
      const data = JSON.parse(row.data) as { modelID?: unknown; model?: { modelID?: unknown } };
      const m = slug(data.modelID ?? data.model?.modelID);
      if (m) return m;
    }
    return undefined;
  } finally {
    db.close();
  }
}

function piSessionDir(sessions: string, cwd: string): string {
  return join(sessions, `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
}

function piSessionFile(sessions: string, cwd: string, session: string | undefined): string | undefined {
  if (session) {
    if (!/^[\w-]+$/.test(session)) return undefined;
    const own = piSessionDir(sessions, realDir(cwd));
    const dirs = [
      own,
      ...readdirSync(sessions)
        .map((d) => join(sessions, d))
        .filter((d) => d !== own),
    ];
    for (const dir of dirs) {
      const name = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith(`_${session}.jsonl`)) : undefined;
      if (name) return join(dir, name);
    }
    return undefined;
  }
  for (let dir = realDir(cwd); ; dir = dirname(dir)) {
    const here = piSessionDir(sessions, dir);
    const files = existsSync(here) ? readdirSync(here).filter((f) => f.endsWith(".jsonl")) : [];
    const newest = files.map((f) => join(here, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    if (newest) return newest;
    if (dirname(dir) === dir) return undefined;
  }
}

function piModel(env: Env, cwd: string): string | undefined {
  const sessions = join(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "sessions");
  const file = existsSync(sessions) ? piSessionFile(sessions, cwd, env.KIWI_PI_SESSION) : undefined;
  for (const line of file ? tailLines(file) : []) {
    if (!line.includes('"model')) continue;
    try {
      const l = JSON.parse(line) as { type?: string; modelId?: unknown; message?: { role?: string; model?: unknown } };
      const m = l.type === "model_change" ? slug(l.modelId) : l.type === "message" && l.message?.role === "assistant" ? slug(l.message.model) : undefined;
      if (m) return m;
    } catch {
      // A line cut by the tail's start: older lines may still have it.
    }
  }
  return undefined;
}

export interface HarnessWhere {
  cwd?: string;
  tree?: ProcessTree;
}

/** The model the harness running this command is on, or undefined when it can't be told. */
export async function harnessModel(env: Env = process.env, where: HarnessWhere = {}): Promise<string | undefined> {
  const tries: (() => string | undefined | Promise<string | undefined>)[] = [];
  if (piHere(env, where.tree)) tries.push(() => piModel(env, where.cwd ?? process.cwd()));
  else if (mimoHere(env, where.tree)) tries.push(() => mimoModel(env, where.cwd ?? process.cwd()));
  else if (kimiCodePid(env, where.tree)) tries.push(() => kimiModel(env));
  else {
    if (env.GROK_SESSION_ID) tries.push(() => grokModel(env));
    if (env.CLAUDECODE) tries.push(() => claudeModel(env));
    if (env.CODEX_THREAD_ID) tries.push(() => codexModel(env));
    if (env.OPENCODE_SESSION_ID) tries.push(() => opencodeModel(env));
  }
  for (const t of tries) {
    try {
      const m = await t();
      if (m) return m;
    } catch {
      // Their files, their format: anything unexpected is "can't tell".
    }
  }
  return undefined;
}

// ---------- what it's doing now ----------

/** A tool's name as a harness gives it: short, one token-ish line (its input is never read). */
function toolName(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() && v.length <= 60 ? v.trim() : undefined;
}

/** Claude Code: its process's registry says busy or idle; the transcript's newest lines say which tool is running. */
function claudeActivity(env: Env): Activity | undefined {
  const dir = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const pid = Number(env.CLAUDE_PID);
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  const reg = join(dir, "sessions", `${pid}.json`);
  if (!existsSync(reg)) return undefined;
  const r = JSON.parse(readFileSync(reg, "utf8")) as { sessionId?: string; status?: string; statusUpdatedAt?: number };
  const since = typeof r.statusUpdatedAt === "number" ? r.statusUpdatedAt : undefined;
  if (r.status === "idle") return { state: "idle", ...(since ? { since } : {}) };
  if (r.status && /wait|permission|input/i.test(r.status)) return { state: "waiting", ...(since ? { since } : {}) };
  // Busy: a tool is running while the newest assistant turn asked for one and no result has come back.
  let tool: string | undefined;
  const session = env.CLAUDE_CODE_SESSION_ID || r.sessionId;
  if (session && /^[\w-]+$/.test(session)) {
    const projects = join(dir, "projects");
    const file = readdirSync(projects)
      .map((p) => join(projects, p, `${session}.jsonl`))
      .find((f) => existsSync(f));
    for (const line of file ? tailLines(file, 128 * 1024) : []) {
      if (!line.trim()) continue;
      try {
        const l = JSON.parse(line) as { type?: string; message?: { stop_reason?: string; content?: unknown } };
        if (l.type === "user") break; // a tool's result (or a prompt): nothing running now
        if (l.type !== "assistant") continue;
        if (l.message?.stop_reason === "tool_use" && Array.isArray(l.message.content)) {
          const use = [...(l.message.content as { type?: string; name?: unknown }[])].reverse().find((c) => c.type === "tool_use");
          tool = toolName(use?.name);
        }
        break;
      } catch {
        break;
      }
    }
  }
  return { state: "working", ...(tool ? { tool } : {}), ...(since ? { since } : {}) };
}

/** Codex: the thread's rollout, newest event first: a task started and not completed is work. */
async function codexActivity(env: Env): Promise<Activity | undefined> {
  const thread = env.CODEX_THREAD_ID;
  if (!thread) return undefined;
  const home = env.CODEX_HOME || join(homedir(), ".codex");
  const db = readdirSync(home)
    .filter((f) => /^state_\d+\.sqlite$/.test(f))
    .sort()
    .at(-1);
  if (!db) return undefined;
  const row = (await sqliteOne(join(home, db), "SELECT rollout_path FROM threads WHERE id = ?", thread)) as { rollout_path?: unknown } | null;
  if (typeof row?.rollout_path !== "string" || !existsSync(row.rollout_path)) return undefined;
  for (const line of tailLines(row.rollout_path, 128 * 1024)) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line) as { type?: string; payload?: { type?: string; name?: unknown } };
      const t = l.payload?.type ?? l.type;
      if (t === "task_complete" || t === "turn_aborted") return { state: "idle" };
      if (t === "function_call" || t === "custom_tool_call") return { state: "working", ...(toolName(l.payload?.name) ? { tool: toolName(l.payload?.name) } : {}) };
      if (t === "task_started" || t === "agent_reasoning" || t === "reasoning" || t === "message") return { state: "working" };
    } catch {
      // A line cut by the tail's start.
    }
  }
  return undefined;
}

/** OpenCode: the session row says when it last went idle and when it last changed. */
async function opencodeActivity(env: Env): Promise<Activity | undefined> {
  const session = env.OPENCODE_SESSION_ID;
  if (!session) return undefined;
  const file = join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");
  if (!existsSync(file)) return undefined;
  const row = (await sqliteOne(file, "SELECT time_idle, time_updated FROM session_v2 WHERE id = ?", session)) as { time_idle?: unknown; time_updated?: unknown } | null;
  if (!row) return undefined;
  const idle = Number(row.time_idle);
  const updated = Number(row.time_updated);
  return Number.isFinite(idle) && idle > 0 && idle >= updated ? { state: "idle", since: idle } : { state: "working" };
}

/** Grok Build: its session's update stream; quiet for a minute reads as idle. */
function grokActivity(env: Env): Activity | undefined {
  const session = env.GROK_SESSION_ID;
  if (!session || !/^[\w-]+$/.test(session)) return undefined;
  const sessions = join(env.GROK_HOME || join(homedir(), ".grok"), "sessions");
  for (const ws of readdirSync(sessions)) {
    const file = join(sessions, ws, session, "updates.jsonl");
    if (!existsSync(file)) continue;
    const at = statSync(file).mtimeMs;
    return Date.now() - at > 60_000 ? { state: "idle", since: at } : { state: "working" };
  }
  return undefined;
}

/** What the harness running this process is doing right now, with its model; undefined when it can't be told. */
export async function harnessActivity(env: Env = process.env): Promise<Activity | undefined> {
  const tries: (() => Activity | undefined | Promise<Activity | undefined>)[] = [];
  if (env.GROK_SESSION_ID) tries.push(() => grokActivity(env));
  if (env.CLAUDECODE) tries.push(() => claudeActivity(env));
  if (env.CODEX_THREAD_ID) tries.push(() => codexActivity(env));
  if (env.OPENCODE_SESSION_ID) tries.push(() => opencodeActivity(env));
  for (const t of tries) {
    try {
      const a = await t();
      if (a) {
        const model = await harnessModel(env);
        return { ...a, ...(model ? { model } : {}) };
      }
    } catch {
      // Their files, their format: anything unexpected is "can't tell".
    }
  }
  return undefined;
}
