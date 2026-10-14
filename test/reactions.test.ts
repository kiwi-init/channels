// Reactions (T75): a member's one emoji on a message, and the 👀 an agent leaves on a person's message
// when, in coordinator mode, it takes on what that person asked for, so they know it got through.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { ACK, AgentLive, AgentSession, answersPeople, wants } from "../src/agent.ts";
import { describeEvent } from "../src/format.ts";
import { generateIdentity, sign, verify, type Identity } from "../src/identity.ts";
import { isReaction, wellFormedEvent, type Event, type Kind, type Message } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { fold, type Roster } from "../src/state.ts";
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
    expect([...s.reactions.get(hi.seq)!].map(([n, r]) => [n, r.emoji])).toEqual([["dev", "✅"], ["dev2", "👍"]]);
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
    expect(isReaction(r)).toBe(true);
    expect(isReaction(hi)).toBe(false);
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

  test("a task made from a message (--re) remembers it", async () => {
    const ask = await msg("jon", "msg", "make an icon");
    const add = await msg("coord", "event", "task: icon", { ev: { op: "task.add", title: "icon", owner: "dev" }, re: [ask.seq] });
    expect(fold([ask, add], roster).tasks.get(add.seq)!.source).toBe(ask.seq);
  });
});

describe("whose words an answer answers", () => {
  test("a person's message, directly or through what passed it on; never an agent's own", async () => {
    const ask = await msg("jon", "msg", "fix the build");
    const fwd = await msg("coord", "msg", "jon asks: fix the build", { to: ["dev"], re: [ask.seq] });
    const chat = await msg("dev2", "msg", "an agent's own idea");
    const add = await msg("coord", "event", "task", { ev: { op: "task.add", title: "fix" }, re: [ask.seq] });
    const ms = [ask, fwd, chat, add];
    const s = fold(ms, roster);
    expect(answersPeople(s, ms, [ask.seq])).toEqual([ask.seq]);
    expect(answersPeople(s, ms, [fwd.seq])).toEqual([ask.seq]);
    expect(answersPeople(s, ms, [add.seq])).toEqual([ask.seq]);
    expect(answersPeople(s, ms, [chat.seq])).toEqual([]);
  });
});

describe("in coordinator mode, the agent that takes something on says so with 👀", () => {
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
    await owner.ownerCh.send("coord coordinates", { kind: "event", ev: { op: "role.set", member: "coord", role: "coordinator" } });
    await owner.ownerCh.send("coordinator-only on", { kind: "event", ev: { op: "mode.set", coordinatorOnly: true, strict: true } });
  });
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  const reactionsOn = async (s: AgentSession, on: number) => {
    const { messages, state } = await run(s.state());
    return { emoji: [...(state.reactions.get(on) ?? new Map())].map(([n, r]) => [n, r.emoji]), sent: messages.filter((m) => isReaction(m)).length };
  };

  test("answering the coordinator's forward reacts on the person's message, once", async () => {
    const ask = await owner.ownerCh.send("please fix the build");
    const fwd = await run(coord.send("jon asks: fix the build", { to: ["dev"], re: [ask] }));
    // The coordinator's own answers reach people already: it doesn't react.
    expect((await reactionsOn(dev, ask)).emoji).toEqual([]);
    const before = (await reactionsOn(dev, ask)).sent;
    await run(dev.reply(fwd, "on it"));
    expect((await reactionsOn(dev, ask)).emoji).toEqual([["dev", ACK]]);
    await run(dev.reply(fwd, "done"));
    expect((await reactionsOn(dev, ask)).sent).toBe(before + 1);
  });

  test("claiming a task made from a person's message reacts on it", async () => {
    const ask = await owner.ownerCh.send("we need an app icon");
    const id = await run(coord.taskAdd("app icon", { re: ask }));
    await run(dev.taskClaim(id));
    expect((await reactionsOn(dev, ask)).emoji).toEqual([["dev", ACK]]);
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

  test("with the mode off, an answer reaches people itself: no reaction", async () => {
    await owner.ownerCh.send("coordinator-only off", { kind: "event", ev: { op: "mode.set", coordinatorOnly: false, strict: false } });
    const ask = await owner.ownerCh.send("one more thing");
    await run(dev.reply(ask, "sure"));
    expect((await reactionsOn(dev, ask)).emoji).toEqual([]);
  });
});
