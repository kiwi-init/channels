import { describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { channelFiles, channelTables, runSh, type ChannelView } from "../src/sh.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

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
  return { alias: "alpha", me: "intern", messages, state: fold(messages, roster), cursor: 0 };
}

describe("kiwi sh threads and query", () => {
  test("log.jsonl carries task and esc, and threads/ splits by place", async () => {
    const v = await fixture();
    const files = channelFiles([v]);
    const log = (files["/channel/log.jsonl"] ?? "").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.find((e) => e.body === "need a decision")?.esc).toBe(true);
    expect(log.find((e) => e.body === "working on it")?.task).toBe(1);
    expect(files["/channel/threads/T1.jsonl"]).toContain("working on it");
    expect(files["/channel/threads/main.jsonl"]).toContain("hello main");
    expect(files["/channel/threads/main.jsonl"]).not.toContain("working on it");
  });

  test("query answers select and returns JSON lines", async () => {
    const v = await fixture();
    const r = await runSh(channelFiles([v]), `query "select body from messages where esc=1" | jq -r .body`, { tables: channelTables([v]) });
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("need a decision\n");
  });

  test("query refuses writes, attach and pragma", async () => {
    const v = await fixture();
    const tables = channelTables([v]);
    for (const sql of ["delete from messages", "attach database '/tmp/x.db' as x", "pragma query_only = off", "select 1; delete from messages"]) {
      const r = await runSh(channelFiles([v]), `query "${sql}"`, { tables });
      expect([sql, r.exitCode]).toEqual([sql, 1]);
      expect([sql, r.stderr]).toEqual([sql, "query: one select, with or values statement only (no attach, detach, pragma, vacuum, recursive or ';' outside a string)\n"]);
    }
    const after = await runSh(channelFiles([v]), `query "select count(*) as n from messages"`, { tables });
    expect(after.stdout.trim()).toBe(`{"n":4}`);
  });

  test("a semicolon inside a string is fine, and duplicate column names are kept", async () => {
    const v = await fixture();
    const tables = channelTables([v]);
    const a = await runSh(channelFiles([v]), `query "select ';' as s"`, { tables });
    expect(a.stdout).toBe(`{"s":";"}\n`);
    const b = await runSh(channelFiles([v]), `query "select 1 as x, 2 as x"`, { tables });
    expect(b.stdout).toBe(`{"x":1,"x_2":2}\n`);
  });

  test("a task's messages join to tasks on the T<n> id", async () => {
    const v = await fixture();
    const r = await runSh(channelFiles([v]), `query "select t.title from tasks t join messages m on m.task = t.id"`, { tables: channelTables([v]) });
    expect(r.stdout).toBe(`{"title":"Ship it"}\n`);
  });

  test("query --schema lists the tables", async () => {
    const r = await runSh({}, "query --schema");
    expect(r.stdout).toContain("messages(");
    expect(r.stdout).toContain("rounds(");
  });
});
