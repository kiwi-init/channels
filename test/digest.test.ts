import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentLive, AgentSession } from "../src/agent.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, placeKey, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { taskDigest } from "@kiwi/core/work.ts";
import { messageHead } from "@kiwi/core/format.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, pairComputer, setupChannel } from "./owner.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { ev?: Event; re?: number[]; task?: number } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => msg(from, "event", "", { ev: e });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac", "win"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("a closed task's digest", () => {
  test("outcome, last note besides the approval, its PRs once each, who worked it, who approved, how much was said", async () => {
    const add = await ev("jon", { op: "task.add", title: "Ship the digest", owner: "mac", review: "jon" });
    const t = add.seq;
    const log = [
      add,
      await ev("mac", { op: "task.update", task: t, state: "doing", note: "PR https://github.com/ojow/channels/pull/12" }),
      await msg("mac", "msg", `T${t}: halfway, see https://github.com/ojow/channels/pull/12`),
      await ev("win", { op: "task.update", task: t, note: "and https://github.com/ojow/channels/pull/13" }),
      await ev("mac", { op: "task.update", task: t, state: "review", note: "ready" }),
      await ev("jon", { op: "task.update", task: t, state: "done", verdict: "approved", note: "approved", round: 1 }),
    ];
    const s = fold(log, roster);
    expect(taskDigest(s, log, s.tasks.get(t)!)).toBe(`T${t} done: Ship the digest · ready · PR ojow/channels#12, ojow/channels#13 · by mac · approved by jon · 1 message in its threads`);
  });

  test("its PRs are the ones posted about it, not every PR in a thread that once named it (T101)", async () => {
    const add = await ev("jon", { op: "task.add", title: "Drop images", owner: "mac" });
    const t = add.seq;
    const ask = await msg("jon", "msg", `Fixes: T${t} and the rest`);
    const log = [
      add,
      ask,
      await msg("mac", "msg", `T${t}: PR https://github.com/ojow/channels/pull/21`, { re: [ask.seq] }),
      await msg("win", "msg", "mine is up: https://github.com/ojow/livewire/pull/255", { re: [ask.seq] }),
      await ev("jon", { op: "task.update", task: t, state: "done" }),
    ];
    const s = fold(log, roster);
    expect(taskDigest(s, log, s.tasks.get(t)!)).toBe(`T${t} done: Drop images · PR ojow/channels#21 · by mac · 3 messages in its threads`);
  });

  test("a cancelled one says why, and no approval", async () => {
    const add = await ev("jon", { op: "task.add", title: "Old idea", owner: "mac" });
    const log = [add, await ev("jon", { op: "task.update", task: add.seq, state: "cancelled", note: "superseded by T9" })];
    const s = fold(log, roster);
    expect(taskDigest(s, log, s.tasks.get(add.seq)!)).toBe(`T${add.seq} cancelled: Old idea · superseded by T9 · by mac`);
  });

  test("an assign note is the brief the task was handed over with, not what came of it (T150)", async () => {
    const add = await ev("jon", { op: "task.add", title: "Joining screens", owner: "mac" });
    const t = add.seq;
    const log = [
      add,
      await ev("mac", { op: "task.update", task: t, state: "doing", note: "invite step first" }),
      await ev("jon", { op: "task.update", task: t, owner: "win", note: "moved off mac's queue: read the gap list first" }),
      await ev("win", { op: "task.update", task: t, state: "done" }),
    ];
    const s = fold(log, roster);
    expect(taskDigest(s, log, s.tasks.get(t)!)).toBe(`T${t} done: Joining screens · invite step first · by mac, win`);
  });

  test("a checkpoint is the agent's own notes, so the digest says the last note before it", async () => {
    const add = await ev("jon", { op: "task.add", title: "Fix the bar", owner: "mac" });
    const t = add.seq;
    const log = [
      add,
      await ev("mac", { op: "task.update", task: t, note: "the bar clicks again" }),
      await ev("mac", { op: "task.update", task: t, note: "# T1 checkpoint\n- Worktree: /tmp/x, branch T1-bar", checkpoint: true }),
      await ev("jon", { op: "task.update", task: t, state: "done" }),
    ];
    const s = fold(log, roster);
    expect(taskDigest(s, log, s.tasks.get(t)!)).toBe(`T${t} done: Fix the bar · the bar clicks again · by mac`);
  });
});

describe("a digest whose closing event the channel refused", () => {
  test("is refused too and marked, and one after an accepted close is not, from a full fold or a kept base alike", async () => {
    const add = await ev("jon", { op: "task.add", title: "Ship the digest", owner: "mac", review: "jon" });
    const refusedClose = await ev("win", { op: "task.update", task: add.seq, state: "done" });
    const refusedDigest = await msg("win", "done", "Ship the digest done", { task: add.seq });
    const acceptedClose = await ev("jon", { op: "task.update", task: add.seq, state: "done" });
    const acceptedDigest = await msg("jon", "done", "Ship the digest done", { task: add.seq });
    const log = [add, refusedClose, refusedDigest, acceptedClose, acceptedDigest];
    const state = fold(log, roster);
    expect(state.rejected.has(refusedClose.seq)).toBe(true);
    expect(state.rejected.get(refusedDigest.seq)).toBe(`win's close of T${add.seq} was refused`);
    expect(state.rejected.has(acceptedDigest.seq)).toBe(false);
    expect(messageHead(refusedDigest, undefined, state)).toContain("[done] [its close was refused by the channel — ignore]");
    expect(messageHead(acceptedDigest, undefined, state)).not.toContain("refused");
    const kept: { base?: FoldBase } = {};
    fold(log.slice(0, 2), roster, Date.now(), null, null, null, (b) => void (kept.base = b));
    const resumed = fold(log.slice(2), roster, Date.now(), null, null, kept.base ?? null);
    expect(kept.base?.n).toBe(refusedClose.seq);
    expect(resumed.rejected.has(refusedDigest.seq)).toBe(true);
    expect(resumed.rejected.has(acceptedDigest.seq)).toBe(false);
  });
});

describe("where a closed task's digest is posted", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-digest-relay-"));
  const home = mkdtempSync(join(tmpdir(), "kiwi-digest-home-"));
  const was = process.env.KIWI_HOME;
  let server: ReturnType<typeof startRelay>;
  const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);
  let dev: AgentSession;

  beforeAll(async () => {
    process.env.KIWI_HOME = home;
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    const owner = await setupChannel(server.url.origin, { ownerName: "jon" });
    const computer = await pairComputer(owner.person);
    const { id, ch } = await joinAgent(owner, "dev", computer);
    dev = new AgentSession("digest", { ...ch.access, relay: owner.relay, code: owner.code }, id, () => {});
  }, 60_000);
  afterAll(() => {
    server.stop(true);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true });
  });

  test("in the task's own thread, not in #general", async () => {
    const id = await run(dev.taskAdd("ship the login page"));
    await run(dev.taskUpdate(id, { state: "done" }));
    const { state, messages } = await run(dev.state());
    const digest = messages.find((m) => m.kind === "done");
    expect(digest?.body).toStartWith(`T${id} done: ship the login page`);
    expect(state.rejected.has(digest?.seq ?? -1)).toBe(false);
    expect(placeKey(state.placeOf.get(digest!.seq)!)).toBe(`task:${id}`);
  }, 60_000);
});
