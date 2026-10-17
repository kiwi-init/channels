// Facts are shared and can expire.

import { describe, expect, test } from "bun:test";
import { formatFact, parseDuration } from "@kiwi/core/format.ts";
import { wellFormedEvent, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { fold as foldWith, type Roster } from "@kiwi/core/state.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";

const roster: Roster = [];
async function member(name: string, owner = false): Promise<Identity> {
  const id = await generateIdentity(name);
  roster.push({ name, pk: id.pk, owner, at: 0, active: true });
  return id;
}
const fold = (ms: Message[], now?: number) => foldWith(ms, roster, now);

let seq = 0;
const T0 = 1_700_000_000_000;
async function msg(id: Identity, from: string, ev: Event, at = T0 + seq * 1000): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as Kind, body: "", ts: at, ev };
  const p = await sign(id, base);
  return { ...p, seq, rts: at, sigOk: await verify(p) };
}

describe("facts are shared and can expire", () => {
  test("anyone can unset, a ttl fact disappears, and the list shows its age", async () => {
    const author = await member("author");
    const other = await member("other");
    const set = await msg(author, "author", { op: "fact.set", key: "build.cmd", value: "cargo test" }, T0);
    const branch = await msg(author, "author", { op: "fact.set", key: "sh.branch", value: "grok/sh", ttl: 7 * 86400 }, T0);
    const fresh = fold([set, branch], T0 + 3600_000);
    expect(fresh.facts.get("build.cmd")?.value).toBe("cargo test");
    expect(fresh.facts.get("sh.branch")?.expires).toBe(T0 + 7 * 86400_000);
    expect(formatFact(fresh.facts.get("sh.branch")!, T0 + 3600_000)).toContain("1h ago");
    expect(formatFact(fresh.facts.get("sh.branch")!, T0 + 3600_000)).toContain("left");

    const cleared = await msg(other, "other", { op: "fact.del", key: "build.cmd" }, T0 + 2000);
    const after = fold([set, branch, cleared], T0 + 3600_000);
    expect(after.facts.has("build.cmd")).toBe(false);
    expect(after.facts.has("sh.branch")).toBe(true);
    expect(fold([set, branch], T0 + 8 * 86400_000).facts.has("sh.branch")).toBe(false);
    expect(fold([set, branch], T0 + 8 * 86400_000).facts.has("build.cmd")).toBe(true);
    expect(parseDuration("7d")).toBe(7 * 86400);
    expect(wellFormedEvent({ op: "fact.set", key: "k", value: "v", ttl: 3600 })).toBe(true);
  });
});
