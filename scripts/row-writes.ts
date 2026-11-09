import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "../test/owner.ts";

type Env = Record<string, string>;
type Stmt = { run: (...p: unknown[]) => unknown; all: (...p: unknown[]) => unknown[]; get: (...p: unknown[]) => unknown; values: (...p: unknown[]) => unknown[] };

const tally = new Map<string, number>();
const statements = new Map<string, number>();
let counting = false;
const indexCount = new WeakMap<Database, Map<string, number>>();
const originalQuery = Database.prototype.query;
const wrapped = new WeakSet<object>();

const raw = <T>(db: Database, q: string): T => originalQuery.call(db, q).get() as T;

function indexesOf(db: Database, table: string): number {
  let byTable = indexCount.get(db);
  if (!byTable) indexCount.set(db, (byTable = new Map()));
  let n = byTable.get(table);
  if (n === undefined) {
    n = (originalQuery.call(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").get(table) as { n: number }).n;
    byTable.set(table, n);
  }
  return n;
}

const kindOf = (db: Database): string => {
  const name = basename(db.filename || ":memory:");
  if (name === "people.sqlite") return "people";
  if (name === ":memory:" || name === "") return "memory";
  return /^[A-Za-z0-9_-]{16,}(\.sqlite)?$/.test(name) ? "room" : name.replace(/\.sqlite$/, "");
};

function billed(db: Database, sql: string, changes: number, inserted: boolean): { table: string; rows: number } | null {
  const s = sql.trim().replace(/\s+/g, " ");
  const op = /^(INSERT|UPDATE|DELETE|REPLACE)\b/i.exec(s)?.[1]?.toUpperCase();
  if (!op || !changes) return null;
  const table = (op === "UPDATE" ? /^UPDATE (?:OR \w+ )?(\w+)/i : op === "DELETE" ? /^DELETE FROM (\w+)/i : /INTO (\w+)/i).exec(s)?.[1] ?? "?";
  const idx = indexesOf(db, table);
  const upsert = /ON CONFLICT\b[^)]*\)? DO UPDATE/i.test(s);
  const perRow = op === "UPDATE" || (upsert && !inserted) ? 1 : 1 + idx;
  return { table, rows: changes * perRow };
}

function wrap(db: Database, sql: string, st: Stmt): void {
  if (wrapped.has(st)) return;
  wrapped.add(st);
  if (!/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) return;
  for (const m of ["run", "all", "get", "values"] as const) {
    const orig = st[m].bind(st) as (...p: unknown[]) => unknown;
    (st as Record<string, unknown>)[m] = (...p: unknown[]) => {
      const before = counting ? raw<{ r: number }>(db, "SELECT last_insert_rowid() AS r").r : 0;
      const out = orig(...p);
      if (counting) {
        const { c } = raw<{ c: number }>(db, "SELECT changes() AS c");
        const after = raw<{ r: number }>(db, "SELECT last_insert_rowid() AS r").r;
        const b = billed(db, sql, c, after !== before);
        if (b) {
          const key = `${kindOf(db)}.${b.table}`;
          tally.set(key, (tally.get(key) ?? 0) + b.rows);
          const line = `${key}  ${sql.trim().replace(/\s+/g, " ").slice(0, 110)}`;
          statements.set(line, (statements.get(line) ?? 0) + b.rows);
        }
      }
      return out;
    };
  }
}

Database.prototype.query = function (this: Database, sql: string) {
  const st = originalQuery.call(this, sql) as unknown as Stmt;
  wrap(this, sql, st);
  return st as never;
} as typeof Database.prototype.query;

const made: string[] = [];
const scratch = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-row-writes-${tag}-`));
  made.push(d);
  return d;
};

const rounds = Number(process.argv.find((a) => a.startsWith("--rounds="))?.slice("--rounds=".length) ?? 10);
const out = process.argv.find((a) => a.startsWith("--json="))?.slice("--json=".length);
process.env.KIWI_QUOTA_PERSON_MESSAGES_PER_DAY ??= "1000";
const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch("relay") });
const relay = server.url.origin;
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agentA = scratch("a");
const agentB = scratch("b");
const bin = scratch("bin");
writeFileSync(join(bin, "kiwi"), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(import.meta.dir, "../src/cli/main.ts"))} "$@"\n`, { mode: 0o755 });

const session = (id: string): Env => ({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: id, CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" });

function spawn(home: string, args: string[], env: Env, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "", KIWI_MODEL: "claude-opus-5-5", ...env },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, args: string[], env: Env = {}, stdin?: string): Promise<string> {
  const p = spawn(home, args, env, stdin);
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")} failed: ${o}${e}`);
  return o + e;
}

const asOwner = (args: string[]): Promise<string> => ok(owner, args, { CLAUDECODE: "" });
const hook = (home: string, id: string, event: string): Promise<string> => ok(home, ["hook", event], session(id), JSON.stringify({ session_id: id, cwd: home }));

async function until(pred: () => Promise<boolean>, label: string, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

async function joinAs(home: string, id: string, code: string): Promise<string> {
  const joining = spawn(home, ["join", code, "--timeout", "60s"], session(id));
  const said = Promise.all([new Response(joining.stdout).text(), new Response(joining.stderr).text()]).then(([o, e]) => o + e);
  let listed = "";
  await until(async () => {
    listed = await asOwner(["--as", "human", "requests"]);
    return /\d{3}-\d{3}/.test(listed);
  }, "the join request");
  await asOwner(["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
  if ((await joining.exited) !== 0) throw new Error(`join failed: ${await said}`);
  const handle = /You're "([^"]+)"/.exec(await said)?.[1];
  if (!handle) throw new Error("no handle in the join output");
  await until(async () => (await daemonListening(daemonSock(home)).catch(() => [])).some((s) => s.agent === handle), `${handle}'s daemon`);
  return handle;
}

const roomMsgs = (): number => tally.get("room.msgs") ?? 0;

try {
  const code = /join code: (\S+)/.exec(await asOwner(["create", "rows", "--as", "boss"]))![1]!;
  const a = await joinAs(agentA, "sa", code);
  await joinAs(agentB, "sb", code);
  await hook(agentA, "sa", "session-start");
  await hook(agentB, "sb", "session-start");
  await Bun.sleep(500);

  counting = true;
  const t0 = performance.now();
  const task = /\bT\d+\b/.exec(await ok(agentB, ["task", "add", "Speed up the CI cache", "--ask", "1", "--start"], session("sb")).catch(() => ""))?.[0];
  for (let i = 0; i < rounds; i++) {
    await asOwner(["--as", "human", "send", `Round ${i + 1}: can someone check the staging deploy?`]);
    await hook(agentA, "sa", "prompt");
    await ok(agentA, ["send", `On it, round ${i + 1}: staging looks fine from here.`], session("sa"));
    await ok(agentB, ["send", ...(task ? ["--to", task] : []), `Progress ${i + 1}: cache step is down to ${40 - i}s.`], session("sb"));
    await ok(agentB, ["send", "--to", `@${a}`, `Direct ${i + 1}: the cache key includes the lockfile hash.`], session("sb"));
    await hook(agentA, "sa", "prompt");
    await hook(agentA, "sa", "stop");
    await hook(agentB, "sb", "prompt");
    await hook(agentB, "sb", "stop");
  }
  await Bun.sleep(1000);
  counting = false;

  const msgs = roomMsgs();
  const pruned = tally.get("room.sends") ?? 0;
  if (pruned) tally.set("room.sends (pruned within the hour)", pruned);
  const total = [...tally.values()].reduce((n, v) => n + v, 0);
  const rows = [...tally.entries()].sort((x, y) => y[1] - x[1]);
  console.log(`\n${msgs} messages stored, ${total} rows written: ${(total / msgs).toFixed(1)} per message (${((performance.now() - t0) / 1000).toFixed(0)}s)\n`);
  console.log("table".padEnd(28), "rows".padStart(7), "per msg".padStart(8));
  for (const [k, v] of rows) console.log(k.padEnd(28), String(v).padStart(7), (v / msgs).toFixed(2).padStart(8));
  console.log("\nstatements:");
  for (const [k, v] of [...statements.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25)) console.log(String(v).padStart(6), (v / msgs).toFixed(2).padStart(6), k);
  if (out) writeFileSync(out, JSON.stringify({ msgs, total, perMessage: total / msgs, tables: Object.fromEntries(rows) }, null, 2));
} finally {
  await Promise.all([agentA, agentB].map((h) => stopDaemon(daemonSock(h)).catch(() => undefined)));
  server.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
}
