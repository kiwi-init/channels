// Reactions (T75): a member's one emoji on a message.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession, wants } from "../src/agent.ts";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { isOverlay, wellFormedEvent, type Event, type Kind, type Message } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";

setDefaultTimeout(60_000);

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { to?: string[]; ev?: Event; re?: number[] } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const react = (from: string, on: number, emoji: string | null) => msg(from, "event", "reaction", { ev: { op: "react", seq: on, emoji } });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "coord", "dev", "dev2", "reader"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "coord", pk: ids.coord!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "dev2", pk: ids.dev2!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "reader", pk: ids.reader!.pk, owner: false, at: 4, active: true, kind: "agent", scopes: [] },
  ];
});

describe("the react event", () => {
  test("one per member per message, the latest wins, null takes it back", async () => {
    const hi = await msg("jon", "msg", "fix the build");
    const ms = [hi, await react("dev", hi.seq, "👀"), await react("dev2", hi.seq, "👍"), await react("dev", hi.seq, "✅")];
    const s = fold(ms, roster);
    expect([...s.reactions.get(hi.seq)!].map(([n, r]) => [n, r.emoji])).toEqual([
      ["dev", "✅"],
      ["dev2", "👍"],
    ]);
    // Reactions aren't messages of theirs.
    expect(s.members.get("dev")!.messages).toBe(0);
    expect(s.members.get("jon")!.messages).toBe(1);
    const back = fold([...ms, await react("dev", hi.seq, null), await react("dev2", hi.seq, null)], roster);
    expect(back.reactions.has(hi.seq)).toBe(false);
  });

  test("only on a message there is: not a later one, not another reaction; and only from who may post", async () => {
    const hi = await msg("jon", "msg", "hello");
    const r = await react("dev", hi.seq, "👀");
    const ms = [hi, r, await react("dev", seq + 50, "👀"), await react("dev2", r.seq, "👀"), await react("reader", hi.seq, "👀")];
    const s = fold(ms, roster);
    expect([...s.reactions.get(hi.seq)!.keys()]).toEqual(["dev"]);
    expect(s.rejected.get(ms[2]!.seq)).toContain("no message");
    expect(s.rejected.get(ms[3]!.seq)).toContain("no message");
    expect(s.trust.get(ms[4]!.seq)).toBe("refused");
  });

  test("it isn't news: no place, nothing in a feed, nothing an agent is handed unless it asks for everything", async () => {
    const hi = await msg("jon", "msg", "hello");
    const r = await react("dev", hi.seq, "👀");
    const s = fold([hi, r], roster);
    expect(s.placeOf.has(r.seq)).toBe(false);
    expect([...s.places.values()].reduce((n, p) => n + p.count, 0)).toBe(1);
    expect(isOverlay(r)).toBe(true);
    expect(isOverlay(hi)).toBe(false);
    for (const me of ["jon", "coord", "dev2"]) expect(wants(me, r, s)).toBe(false);
    expect(wants("jon", r, s, { all: true })).toBe(true);
    expect(describeEvent(r)).toBe(`reacted 👀 to #${hi.seq}`);
  });

  test("an emoji, short: no words, markup, padding or a run of them", () => {
    for (const e of ["👀", "👍", "👩‍💻", "🇧🇷", "❤️", null]) expect(wellFormedEvent({ op: "react", seq: 1, emoji: e })).toBe(true);
    for (const e of ["ok", "+1", "<b>", " 👀", "", "👀".repeat(9)]) expect(wellFormedEvent({ op: "react", seq: 1, emoji: e })).toBe(false);
    expect(wellFormedEvent({ op: "react", seq: 0, emoji: "👀" })).toBe(false);
    expect(wellFormedEvent({ op: "react", emoji: "👀" })).toBe(false);
  });

  test("a GIF reaction folds like an emoji: it replaces that member's earlier one, and the latest wins", async () => {
    const hi = await msg("jon", "msg", "shipped");
    const ms = [hi, await react("dev", hi.seq, "👍"), await react("dev2", hi.seq, "🎉"), await react("dev", hi.seq, "celebrate/hard-work")];
    expect(wellFormedEvent(ms[3]!.ev)).toBe(true);
    const s = fold(ms, roster);
    expect(s.rejected.has(ms[3]!.seq)).toBe(false);
    expect(s.trust.get(ms[3]!.seq)).toBe("verified");
    expect([...s.reactions.get(hi.seq)!].map(([n, r]) => [n, r.emoji])).toEqual([
      ["dev", "celebrate/hard-work"],
      ["dev2", "🎉"],
    ]);
    const back = fold([...ms, await react("dev", hi.seq, null)], roster);
    expect([...back.reactions.get(hi.seq)!].map(([n, r]) => [n, r.emoji])).toEqual([["dev2", "🎉"]]);
  });

  test("a task made from a message (--re) remembers it", async () => {
    const ask = await msg("jon", "msg", "make an icon");
    const add = await msg("coord", "event", "task: icon", { ev: { op: "task.add", title: "icon", owner: "dev" }, re: [ask.seq] });
    expect(fold([ask, add], roster).tasks.get(add.seq)!.source).toBe(ask.seq);
  });
});

describe("over a relay", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-react-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-react-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  let coord: AgentSession;
  let dev: AgentSession;
  let owner: Awaited<ReturnType<typeof setupChannel>>;

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    const computer = await pairComputer(owner.person);
    const session = async (name: string) => {
      const { id, ch } = await joinAgent(owner, name, computer);
      return new AgentSession("react", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
    };
    coord = await session("coord");
    dev = await session("dev");
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  const reactionsOn = async (s: AgentSession, on: number) => {
    const { messages, state } = await run(s.state());
    return { emoji: [...(state.reactions.get(on) ?? new Map())].map(([n, r]) => [n, r.emoji]), sent: messages.filter((m) => isOverlay(m)).length };
  };

  test("answering a message or claiming a task made from one leaves no reaction by itself", async () => {
    const ask = await owner.ownerCh.send("please fix the build");
    const fwd = await run(coord.send("jon asks: fix the build", { to: ["dev"], re: [ask] }));
    await run(dev.reply(fwd, "on it"));
    const id = await run(coord.taskAdd("fix the build", { re: ask }));
    await run(dev.taskClaim(id));
    expect((await reactionsOn(dev, ask)).emoji).toEqual([]);
  });

  test("an agent may react with a GIF key, and it shows like any reaction", async () => {
    const hi = await owner.ownerCh.send("done for today");
    await run(dev.react(hi, "ok/trailer"));
    expect((await reactionsOn(dev, hi)).emoji).toEqual([["dev", "ok/trailer"]]);
  });

  test("by hand, anyone may react, and take it back", async () => {
    const hi = await owner.ownerCh.send("thanks all");
    await run(dev.react(hi, "👍"));
    expect((await reactionsOn(dev, hi)).emoji).toEqual([["dev", "👍"]]);
    await run(dev.react(hi, null));
    expect((await reactionsOn(dev, hi)).emoji).toEqual([]);
    await expect(run(dev.react(hi, "nice"))).rejects.toThrow(/one emoji/);
    await expect(run(dev.react(hi + 999, "👍"))).rejects.toThrow(/no message/);
  });
});
