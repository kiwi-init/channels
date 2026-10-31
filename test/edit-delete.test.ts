import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wants } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { changeTo } from "@kiwi/core/changes.ts";
import { formatMessage } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { wellFormedEvent, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { fold, rosterOf, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { joinPerson, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(60_000);

const ids: Record<string, Identity> = {};
let seq = 0;
let roster: Roster;

async function msg(from: string, body: string, extra: { kind?: Kind; ev?: Event; to?: string[]; esc?: true } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: extra.kind ?? (extra.ev ? ("event" as const) : ("msg" as const)), body, ts: seq, ...extra };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const edit = (from: string, target: number, body: string, to?: string[]) => msg(from, `edited #${target}`, { ev: { op: "msg.edit", seq: target, body }, ...(to ? { to } : {}) });
const del = (from: string, target: number) => msg(from, `deleted #${target}`, { ev: { op: "msg.delete", seq: target } });

beforeAll(async () => {
  for (const n of ["jow", "jow-2", "mac", "ana", "bo"]) ids[n] = await generateIdentity(n);
  const jow = { user: "u-jow", name: "Jow", handle: "jow" };
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human", sponsor: jow },
    { name: "jow-2", pk: ids["jow-2"]!.pk, owner: false, at: 1, active: true, kind: "human", sponsor: jow },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 2, active: true, kind: "agent", sponsor: jow },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 3, active: true, kind: "human", sponsor: { user: "u-ana", name: "Ana", handle: "ana" } },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 4, active: true, kind: "agent", sponsor: { user: "u-ana", name: "Ana", handle: "ana" } },
  ];
});

describe("editing and deleting your own messages (T971)", () => {
  test("both events are well formed only with a target, and an edit only with text", () => {
    expect(wellFormedEvent({ op: "msg.edit", seq: 3, body: "fixed" })).toBe(true);
    expect(wellFormedEvent({ op: "msg.edit", seq: 3, body: "  " })).toBe(false);
    expect(wellFormedEvent({ op: "msg.edit", seq: 0, body: "x" })).toBe(false);
    expect(wellFormedEvent({ op: "msg.delete", seq: 3 })).toBe(true);
    expect(wellFormedEvent({ op: "msg.delete", seq: -1 })).toBe(false);
  });

  test("the author edits, the latest edit wins, and another device of the same person counts as the author", async () => {
    const hi = await msg("jow", "deploy at 3");
    const ms = [hi, await edit("jow", hi.seq, "deploy at 4"), await edit("jow-2", hi.seq, "deploy at 5")];
    const s = fold(ms, roster);
    expect(s.rejected.size).toBe(0);
    expect(s.edits.get(hi.seq)?.body).toBe("deploy at 5");
  });

  test("an agent can't edit its human's message, nor a person an agent's, nor anyone someone else's", async () => {
    const jows = await msg("jow", "mine");
    const macs = await msg("mac", "the agent's");
    const anas = await msg("ana", "ana's");
    const tries = [await edit("mac", jows.seq, "x"), await del("mac", jows.seq), await edit("jow", macs.seq, "x"), await edit("bo", anas.seq, "x"), await edit("jow", anas.seq, "x")];
    const s = fold([jows, macs, anas, ...tries], roster);
    for (const t of tries) expect(s.rejected.get(t.seq)).toContain("only who wrote");
    expect(s.edits.size).toBe(0);
    expect(s.deleted.size).toBe(0);
  });

  test("questions, escalations and events can't be changed: others act on them", async () => {
    const ask = await msg("jow", "A or B?", { kind: "ask" });
    const esc = await msg("mac", "jow, may I?", { to: ["jow"], esc: true });
    const ev = await msg("jow", "task: x", { ev: { op: "task.add", title: "x" } });
    const tries = [await edit("jow", ask.seq, "C?"), await del("mac", esc.seq), await edit("jow", ev.seq, "y")];
    const s = fold([ask, esc, ev, ...tries], roster);
    for (const t of tries) expect(s.rejected.get(t.seq)).toContain("can be edited or deleted");
  });

  test("a delete is final and clears any edit; nothing changes it afterwards", async () => {
    const hi = await msg("ana", "wrong channel, sorry");
    const ms = [hi, await edit("ana", hi.seq, "oops"), await del("ana", hi.seq), await edit("ana", hi.seq, "back?"), await del("ana", hi.seq)];
    const s = fold(ms, roster);
    expect(s.deleted.has(hi.seq)).toBe(true);
    expect(s.edits.has(hi.seq)).toBe(false);
    expect(s.rejected.get(ms[3]!.seq)).toContain("already deleted");
    expect(s.rejected.get(ms[4]!.seq)).toContain("already deleted");
  });

  test("edits and deletes survive a fold from a base, and authors are known past it", async () => {
    const a = await msg("jow", "first");
    const b = await msg("ana", "second");
    const before = [a, b, await edit("jow", a.seq, "first, fixed"), await del("ana", b.seq)];
    let base: FoldBase | null = null;
    fold(before, roster, Date.now(), null, null, null, (k) => (base = k));
    const after = [...before, await edit("jow", a.seq, "first, fixed again"), await edit("mac", a.seq, "not yours")];
    const s = fold(after, roster, Date.now(), null, null, base);
    expect(s.edits.get(a.seq)?.body).toBe("first, fixed again");
    expect(s.deleted.has(b.seq)).toBe(true);
    expect(s.rejected.get(after[5]!.seq)).toContain("only who wrote");
  });

  test("agents read the current text, marked, and a deleted message as [deleted]", async () => {
    const a = await msg("jow", "ship at 3");
    const b = await msg("jow", "secret token abc");
    const s = fold([a, b, await edit("jow", a.seq, "ship at 4"), await del("jow", b.seq)], roster);
    expect(formatMessage(a, "verified", s, "mac")).toContain("ship at 4 (edited)");
    expect(formatMessage(b, "verified", s, "mac")).toContain("[deleted]");
    expect(formatMessage(b, "verified", s, "mac")).not.toContain("secret token");
  });

  test("an edit wakes exactly the agents its original reached, with the new text", async () => {
    const order = await msg("jow", "@mac deploy main", {});
    const e = await edit("jow", order.seq, "@mac deploy the release branch, not main", changeTo(order));
    const s = fold([order, e], roster);
    expect(wants("mac", e, s)).toBe(true);
    expect(wants("bo", e, s)).toBe(false);
    expect(formatMessage(e, "verified", s, "mac")).toContain("edited #");
    expect(formatMessage(e, "verified", s, "mac")).toContain("deploy the release branch");
  });
});

describe("a removed key can't change messages any more, and its earlier edits stand (T971)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-edit-delete-"));
  let server: ReturnType<typeof startRelay>;
  let s: OwnerSetup;

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    s = await setupChannel(server.url.origin);
  });
  afterAll(() => {
    server.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("an edit before removal holds; after removal the relay refuses the next one", async () => {
    const phone = await joinPerson(s, "tia", await generateIdentity("tia-person"));
    const said = await phone.ch.send("meeting at 3");
    const edited = await phone.ch.send(`edited #${said}`, { kind: "event", ev: { op: "msg.edit", seq: said, body: "meeting at 4" } });
    await s.ownerCh.remove(phone.member.pk);
    await expect(phone.ch.send(`edited #${said}`, { kind: "event", ev: { op: "msg.edit", seq: said, body: "meeting cancelled" } })).rejects.toThrow();
    const { messages } = await s.ownerCh.history(0);
    const state = fold(messages, rosterOf(await s.ownerCh.members()));
    expect(state.rejected.has(edited)).toBe(false);
    expect(state.edits.get(said)?.body).toBe("meeting at 4");
  });
});
