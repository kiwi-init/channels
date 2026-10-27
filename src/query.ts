import { Database } from "bun:sqlite";
import { join } from "node:path";
import { QUERY_ARG } from "./query-arg.ts";
import * as Effect from "effect/Effect";
import type { AgentSession } from "./agent.ts";
import { loadJson, memberLoad } from "@kiwi/core/load.ts";
import { ignored, type Message } from "@kiwi/core/protocol.ts";
import { reviewBody } from "@kiwi/core/format.ts";
import { taskId, type ChannelState } from "@kiwi/core/state.ts";

type Cell = string | number | null;
export type Tables = Record<string, { columns: string[]; rows: Cell[][] }>;

const SCHEMA: Record<string, string[]> = {
  messages: ["seq", "at", "sender", "recipients", "kind", "re", "task", "dm", "room", "esc", "body"],
  tasks: ["id", "title", "state", "owner", "review", "created_by", "created_at"],
  rounds: ["task", "n", "at", "asked_by", "asked_seq", "result", "result_by", "result_seq", "review"],
  members: ["name", "role", "kind", "owner", "last_seen", "load"],
  facts: ["key", "value", "expires_at"],
};

const MAX_ROWS = 5_000;
const READ_ONLY_SQL = /^\s*(select|with|values)\b/i;
const FORBIDDEN_SQL = /\b(attach|detach|pragma|vacuum|recursive|randomblob|zeroblob)\b/i;
const QUERY_MS = 10_000;

export type Ran = { stdout: string; stderr: string; exitCode: number };

export interface ChannelView {
  me: string;
  messages: Message[];
  state: ChannelState;
}

function reviewTexts(messages: Message[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) {
    const body = reviewBody(m);
    if (body && m.ev?.op === "task.update" && m.ev.round !== undefined) out.set(`${m.ev.task}:${m.ev.round}`, body);
  }
  return out;
}

export function queryTables(v: ChannelView): Tables {
  const { state, me } = v;
  const verified = v.messages.filter((m) => !ignored(state.trust.get(m.seq)));
  const reviews = reviewTexts(verified);
  return {
    messages: {
      columns: SCHEMA.messages!,
      rows: verified.map((m) => {
        const place = state.placeOf.get(m.seq);
        const dm = place?.kind === "dm" ? (place.with[0] === me ? place.with[1] : place.with[0]) : null;
        return [
          m.seq,
          new Date(m.rts ?? m.ts).toISOString(),
          m.from,
          m.to?.length ? m.to.join(",") : "all",
          m.kind,
          m.re?.length ? m.re.join(",") : null,
          m.task === undefined ? null : taskId(m.task),
          dm,
          m.room ? (state.rooms.get(m.room)?.name ?? m.room) : null,
          m.esc ? 1 : 0,
          m.body,
        ];
      }),
    },
    tasks: {
      columns: SCHEMA.tasks!,
      rows: [...state.tasks.values()].map((t) => [taskId(t.id), t.title, t.state, t.owner ?? null, t.review ?? null, t.createdBy, new Date(t.createdAt).toISOString()]),
    },
    rounds: {
      columns: SCHEMA.rounds!,
      rows: [...state.tasks.values()].flatMap((t) =>
        t.rounds.map((r): Cell[] => [
          taskId(t.id),
          r.n,
          r.at ?? null,
          r.by,
          r.seq,
          r.result.kind,
          r.result.kind === "approved" || r.result.kind === "rejected" ? r.result.by : null,
          r.result.kind === "open" ? null : r.result.seq,
          reviews.get(`${t.id}:${r.n}`) ?? null,
        ]),
      ),
    },
    members: {
      columns: SCHEMA.members!,
      rows: [...state.members.values()]
        .filter((m) => m.active)
        .map((m) => [
          m.name,
          m.persona?.name ?? null,
          m.kind ?? (m.owner ? "human" : "agent"),
          m.owner ? 1 : 0,
          m.lastSeen ? new Date(m.lastSeen).toISOString() : null,
          loadJson(memberLoad(state, m.name)).level,
        ]),
    },
    facts: {
      columns: SCHEMA.facts!,
      rows: [...state.facts.values()].map((f) => [f.key, f.value, f.expires ? new Date(f.expires).toISOString() : null]),
    },
  };
}

function database(tables: Tables): Database {
  const db = new Database(":memory:");
  for (const [name, t] of Object.entries(tables)) {
    db.run(`create table ${name} (${t.columns.join(", ")})`);
    const insert = db.prepare(`insert into ${name} values (${t.columns.map(() => "?").join(", ")})`);
    for (const row of t.rows) insert.run(...row);
  }
  db.run("pragma query_only = on");
  return db;
}

export const schemaText = () =>
  Object.entries(SCHEMA)
    .map(([name, cols]) => `${name}(${cols.join(", ")})`)
    .join("\n") + "\n";

const fail = (stderr: string, exitCode = 1) => ({ stdout: "", stderr, exitCode });

function bare(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'" || c === '"' || c === "`") {
      const end = sql.indexOf(c, i + 1);
      if (end < 0) return out + " \u0000";
      out += " ";
      i = end + 1;
    } else if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      out += " ";
      i = end < 0 ? sql.length : end + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? sql.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function unique(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n}_${k}`;
  });
}

function runQuery(sql: string, tables: Tables): Ran {
  const db = database(tables);
  try {
    const stmt = db.query(sql);
    const names = unique(stmt.columnNames);
    let out = "";
    let n = 0;
    let cut = false;
    for (const row of stmt.values()) {
      if (n === MAX_ROWS) {
        cut = true;
        break;
      }
      out += JSON.stringify(Object.fromEntries(names.map((k, i) => [k, row[i]]))) + "\n";
      n++;
    }
    return { stdout: out, stderr: cut ? `query: output cut at ${MAX_ROWS} rows; narrow the query\n` : "", exitCode: 0 };
  } catch (err) {
    return fail(`query: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    db.close();
  }
}

function workerArgv(): string[] {
  return /\.(ts|js)$/.test(Bun.main) ? [process.execPath, join(import.meta.dir, "cli", "main.ts"), QUERY_ARG] : [process.execPath, QUERY_ARG];
}

export async function runQueryWorker(): Promise<void> {
  const { sql, tables } = JSON.parse(await Bun.stdin.text()) as { sql: string; tables: Tables };
  process.stdout.write(JSON.stringify(runQuery(sql, tables)));
}

function readRan(text: string): Ran | null {
  try {
    const r = JSON.parse(text) as Partial<Ran>;
    return typeof r.stdout === "string" && typeof r.stderr === "string" && typeof r.exitCode === "number" ? { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode } : null;
  } catch {
    // A worker that died mid-answer: reported as a failed query below.
    return null;
  }
}

export async function queryIsolated(sql: string, tables: Tables, ms = QUERY_MS, argv = workerArgv()): Promise<Ran> {
  const child = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "ignore", env: { ...process.env } });
  child.stdin.write(JSON.stringify({ sql, tables }));
  child.stdin.end();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, ms);
  });
  try {
    const text = await Promise.race([new Response(child.stdout).text(), late]);
    if (text === null) return fail(`query: stopped after ${ms / 1000} s; narrow it (a join of big tables, or a huge value)\n`);
    return readRan(text) ?? fail("query: the query process failed\n");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const USAGE = "usage: kiwi query 'SQL' (or SQL on stdin); kiwi query --schema lists the tables";

export type Checked = { kind: "sql"; sql: string } | { kind: "refused"; ran: Ran };

export function readOnlySql(input: string): Checked {
  const sql = input.trim().replace(/;+$/, "");
  if (!sql) return { kind: "refused", ran: fail(`${USAGE}\n`, 2) };
  const code = bare(sql);
  if (code.includes("\u0000") || !READ_ONLY_SQL.test(code) || FORBIDDEN_SQL.test(code) || code.includes(";")) {
    return { kind: "refused", ran: fail("query: one select, with or values statement only (no attach, detach, pragma, vacuum, recursive, randomblob, zeroblob or ';' outside a string)\n") };
  }
  return { kind: "sql", sql };
}

export const sessionQuery = Effect.fn("query.sessionQuery")(function* (s: AgentSession, input: string) {
  const checked = readOnlySql(input);
  if (checked.kind === "refused") return checked.ran;
  yield* s.unheld;
  const { messages, state } = yield* s.state();
  yield* s.unheld;
  const tables = queryTables({ me: s.me, messages, state });
  return yield* Effect.promise(() => queryIsolated(checked.sql, tables));
});
