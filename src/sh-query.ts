import { Database } from "bun:sqlite";
import { decodeBytesToUtf8, defineCommand, type Command } from "just-bash";
import { loadJson, memberLoad } from "@kiwi/core/load.ts";
import { ignored, type Message } from "@kiwi/core/protocol.ts";
import { reviewBody } from "@kiwi/core/format.ts";
import { taskId } from "@kiwi/core/state.ts";
import type { ChannelView } from "./sh.ts";

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
const FORBIDDEN_SQL = /\b(attach|detach|pragma|vacuum|recursive)\b/i;

export function reviewTexts(messages: Message[]): Map<string, string> {
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

const schemaText = () =>
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

export function queryCommand(load: () => Tables | undefined): Command {
  return defineCommand("query", async (args, ctx) => {
    if (args[0] === "--schema") return { stdout: schemaText(), stderr: "", exitCode: 0 };
    const sql = (args.length ? args.join(" ") : decodeBytesToUtf8(ctx.stdin)).trim().replace(/;+$/, "");
    if (!sql) return fail("usage: query 'SQL' (or SQL on stdin); query --schema lists the tables\n", 2);
    const code = bare(sql);
    if (code.includes("\u0000") || !READ_ONLY_SQL.test(code) || FORBIDDEN_SQL.test(code) || code.includes(";")) {
      return fail("query: one select, with or values statement only (no attach, detach, pragma, vacuum, recursive or ';' outside a string)\n");
    }
    const tables = load();
    if (!tables) return fail("query: no channel data in this run\n");
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
  });
}
