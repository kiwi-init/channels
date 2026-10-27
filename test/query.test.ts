import { describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { queryIsolated, queryTables, readOnlySql, schemaText, type ChannelView, type Ran } from "../src/query.ts";

const T0 = 1_700_000_000_000;

async function fixture(): Promise<ChannelView> {
  const human = await generateIdentity("human");
  const intern = await generateIdentity("intern");
  const roster: Roster = [
    { name: "human", pk: human.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "intern", pk: intern.pk, owner: false, at: 0, active: true, role: "intern", kind: "agent" },
  ];
  let seq = 0;
  const msg = async (id: Identity, from: string, init: { kind?: Kind; ev?: Event; body?: string; to?: string[]; task?: number; esc?: true } = {}): Promise<Message> => {
    seq++;
    const base = {
      v: 1 as const,
      id: crypto.randomUUID(),
      from,
      kind: init.kind ?? (init.ev ? "event" : "msg"),
      body: init.body ?? "",
      ts: T0 + seq * 1000,
      ...(init.to ? { to: init.to } : {}),
      ...(init.task !== undefined ? { task: init.task } : {}),
      ...(init.esc ? { esc: init.esc } : {}),
      ...(init.ev ? { ev: init.ev } : {}),
    };
    const p = await sign(id, base);
    return { ...p, seq, rts: T0 + seq * 1000, sigOk: await verify(p) };
  };
  const messages = [
    await msg(human, "human", { ev: { op: "task.add", title: "Ship it", owner: "intern", review: "human" } }),
    await msg(intern, "intern", { body: "working on it", task: 1 }),
    await msg(intern, "intern", { body: "need a decision", to: ["human"], esc: true }),
    await msg(intern, "intern", { body: "hello main" }),
  ];
  return { me: "intern", messages, state: fold(messages, roster) };
}

async function query(v: ChannelView, sql: string): Promise<Ran> {
  const checked = readOnlySql(sql);
  return checked.kind === "refused" ? checked.ran : queryIsolated(checked.sql, queryTables(v));
}

describe("kiwi query", () => {
  test("answers a select with JSON lines, task and esc included", async () => {
    const v = await fixture();
    const r = await query(v, "select body, task from messages where esc=1 or task is not null order by seq");
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(`{"body":"working on it","task":"T1"}\n{"body":"need a decision","task":null}\n`);
  });

  test("refuses writes, attach and pragma", async () => {
    const v = await fixture();
    for (const sql of [
      "delete from messages",
      "attach database '/tmp/x.db' as x",
      "pragma query_only = off",
      "select 1; delete from messages",
      "select randomblob(1000000000)",
      "select length(zeroblob(1000000000))",
    ]) {
      const r = await query(v, sql);
      expect([sql, r.exitCode]).toEqual([sql, 1]);
      expect([sql, r.stderr]).toEqual([sql, "query: one select, with or values statement only (no attach, detach, pragma, vacuum, recursive, randomblob, zeroblob or ';' outside a string)\n"]);
    }
    expect((await query(v, "select count(*) as n from messages;")).stdout.trim()).toBe(`{"n":4}`);
  });

  test("an empty query gives the usage", async () => {
    const r = await query(await fixture(), "  ");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("usage: kiwi query");
  });

  test("a semicolon inside a string is fine, and duplicate column names are kept", async () => {
    const v = await fixture();
    expect((await query(v, "select ';' as s")).stdout).toBe(`{"s":";"}\n`);
    expect((await query(v, "select 1 as x, 2 as x")).stdout).toBe(`{"x":1,"x_2":2}\n`);
  });

  test("a task's messages join to tasks on the T<n> id", async () => {
    const v = await fixture();
    expect((await query(v, "select t.title from tasks t join messages m on m.task = t.id")).stdout).toBe(`{"title":"Ship it"}\n`);
  });

  test("the schema lists the tables", () => {
    expect(schemaText()).toContain("messages(");
    expect(schemaText()).toContain("rounds(");
  });
});

describe("a query's bounds", () => {
  const tables = {
    messages: { columns: ["seq", "body"], rows: Array.from({ length: 300 }, (_, i) => [i + 1, `m${i}`]) },
  };

  test("a query runs in its own process and answers as before", async () => {
    expect(await queryIsolated("select count(*) as n from messages", tables)).toEqual({ stdout: '{"n":300}\n', stderr: "", exitCode: 0 });
    expect((await queryIsolated("select nope from messages", tables)).stderr).toContain("query: no such column: nope");
  });

  test("a query that runs too long is stopped, and the process with it", async () => {
    const started = Date.now();
    const r = await queryIsolated("select count(*) from messages a, messages b, messages c, messages d", tables, 500);
    expect(r).toEqual({ stdout: "", stderr: "query: stopped after 0.5 s; narrow it (a join of big tables, or a huge value)\n", exitCode: 1 });
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
