import { Database } from "bun:sqlite";
import { decodeBytesToUtf8, defineCommand, type Command } from "just-bash";
import { loadJson, memberLoad } from "./load.ts";
import { ignored, type Message } from "./protocol.ts";
import { reviewBody } from "./format.ts";
import { taskId } from "./state.ts";
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
const FORBIDDEN_SQL = /\b(attach|detach|pragma|vacuum)\b/i;

export function reviewTexts(messages: Message[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) {
    const body = reviewBody(m);
    if (body && m.ev?.op === "task.update" && m.ev.round !== undefined) out.set(`${m.ev.task}:${m.ev.round}`, body);
  }
  return out;
}

export function queryTables(v: ChannelView, now = Date.now()): Tables {
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
          m.task ?? null,
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
        .map((m) => [m.name, m.role ?? null, m.kind ?? (m.owner ? "human" : "agent"), m.owner ? 1 : 0, m.lastSeen ? new Date(m.lastSeen).toISOString() : null, loadJson(memberLoad(state, m.name, now)).level]),
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

const schemaText = () => Object.entries(SCHEMA).map(([name, cols]) => `${name}(${cols.join(", ")})`).join("\n") + "\n";

const fail = (stderr: string, exitCode = 1) => ({ stdout: "", stderr, exitCode });

export function queryCommand(tables: Tables | null): Command {
  return defineCommand("query", async (args, ctx) => {
    if (args[0] === "--schema") return { stdout: schemaText(), stderr: "", exitCode: 0 };
    if (!tables) return fail("query: no channel data in this run\n");
    const sql = (args.length ? args.join(" ") : decodeBytesToUtf8(ctx.stdin)).trim().replace(/;+$/, "");
    if (!sql) return fail("usage: query 'SQL' (or SQL on stdin); query --schema lists the tables\n", 2);
    if (!READ_ONLY_SQL.test(sql) || FORBIDDEN_SQL.test(sql) || sql.includes(";")) return fail("query: one select, with or values statement only (no attach, detach, pragma, vacuum or ';')\n");
    const db = database(tables);
    try {
      const out = db.query(sql).all().slice(0, MAX_ROWS);
      return { stdout: out.map((r) => JSON.stringify(r) + "\n").join(""), stderr: "", exitCode: 0 };
    } catch (err) {
      return fail(`query: ${err instanceof Error ? err.message : String(err)}\n`);
    } finally {
      db.close();
    }
  });
}
