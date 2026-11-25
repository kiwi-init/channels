import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { openLive, type LiveState } from "@kiwi/core/live.ts";
import type { Activity } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state/types.ts";
import { LIVE_ABSENT_MS, LIVE_CHECK_MS, LIVE_IDLE_MS, LIVE_REFRESH_MS, liveAbout, LiveBlobs, relayLiveIo, type LiveAbout } from "../src/daemon/live-blobs.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import type { LiveSend, Pusher } from "../src/relay/push.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const working: Activity = { state: "working", since: 1_000 };
const idle: Activity = { state: "idle" };

function rig(status = 200) {
  let at = 10_000;
  let about: LiveAbout | null = { name: "builder-one", face: "builder", color: "green", task: "T50 iPhone", title: "channels" };
  const calls: (["put", LiveState] | ["drop"])[] = [];
  const live = new LiveBlobs({
    now: () => at,
    about: async () => about,
    put: async (s) => {
      calls.push(["put", s]);
      return status;
    },
    drop: async () => {
      calls.push(["drop"]);
      return status;
    },
  });
  return {
    live,
    calls,
    later: (ms: number) => (at += ms),
    set: (next: LiveAbout | null) => (about = next),
    setStatus: (s: number) => (status = s),
  };
}

describe("an agent's live blob", () => {
  test("goes up once when it starts working, with the time it started", async () => {
    const r = rig();
    await r.live.tick(idle);
    await r.live.tick(undefined);
    expect(r.calls).toEqual([]);
    await r.live.tick(working);
    r.later(3_000);
    await r.live.tick(working);
    expect(r.calls).toEqual([["put", { v: 1, n: "builder-one", f: "builder", c: "green", t: "T50 iPhone", s: 1_000, h: "channels" }]]);
  });

  test("changes when its task changes, and is put again before the relay forgets it", async () => {
    const r = rig();
    await r.live.tick(working);
    r.set({ name: "builder-one", face: "builder", task: "T52 Relay", title: "channels" });
    r.later(LIVE_CHECK_MS);
    await r.live.tick(working);
    r.later(LIVE_CHECK_MS);
    await r.live.tick(working);
    r.later(LIVE_REFRESH_MS);
    await r.live.tick(working);
    expect(r.calls.map((c) => (c[0] === "put" ? c[1].t : "drop"))).toEqual(["T50 iPhone", "T52 Relay", "T52 Relay"]);
  });

  test("stays up through a short pause between turns, and comes down after a long one", async () => {
    const r = rig();
    await r.live.tick(working);
    await r.live.tick(idle);
    r.later(LIVE_IDLE_MS - 1_000);
    await r.live.tick({ state: "waiting" });
    await r.live.tick(working);
    await r.live.tick(idle);
    r.later(LIVE_IDLE_MS);
    await r.live.tick(idle);
    await r.live.tick(idle);
    expect(r.calls.map((c) => c[0])).toEqual(["put", "drop"]);
    r.later(1_000);
    await r.live.tick({ state: "working", since: 99_000 });
    expect(r.calls.at(-1)).toEqual(["put", expect.objectContaining({ s: 99_000 })]);
  });

  test("an older relay without the route is left alone for an hour", async () => {
    const r = rig(404);
    await r.live.tick(working);
    r.later(LIVE_ABSENT_MS - 1_000);
    await r.live.tick(working);
    expect(r.calls).toHaveLength(1);
    r.setStatus(200);
    r.later(2_000);
    await r.live.tick(working);
    expect(r.calls).toHaveLength(2);
  });

  test("a failed put is tried again on the next tick", async () => {
    const r = rig(503);
    await r.live.tick(working);
    r.setStatus(200);
    await r.live.tick(working);
    expect(r.calls).toHaveLength(2);
    await r.live.tick(working);
    expect(r.calls).toHaveLength(2);
  });

  test("closing the seat takes it down", async () => {
    const r = rig();
    await r.live.close();
    await r.live.tick(working);
    await r.live.close();
    expect(r.calls.map((c) => c[0])).toEqual(["put", "drop"]);
  });

  test("names the agent by its display name, the lead's face or its persona's, and its task in progress", () => {
    const state = {
      lead: "tidy-gazelle",
      members: new Map([
        ["tender-marten", { name: "tender-marten", display: "builder-one", color: "green", persona: { role: "builder" } }],
        ["tidy-gazelle", { name: "tidy-gazelle", persona: { role: "lead" } }],
      ]),
      tasks: new Map([
        [7, { id: 7, title: "Old work", owner: "tender-marten", state: "done" }],
        [52, { id: 52, title: "Relay: Live Activity pushes", owner: "tender-marten", state: "doing" }],
      ]),
    } as unknown as ChannelState;
    expect(liveAbout(state, "tender-marten", "channels")).toEqual({ name: "builder-one", face: "builder", color: "green", task: "T52 Relay: Live Activity pushes", title: "channels" });
    expect(liveAbout(state, "tidy-gazelle", "channels")).toEqual({ name: "tidy-gazelle", face: "lead", color: null, task: null, title: "channels" });
    expect(liveAbout(state, "nobody", "channels")).toBeNull();
  });
});

describe("the daemon's blob reaches the phone sealed", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-live-daemon-"));
  const pushed: LiveSend[] = [];
  let server: ReturnType<typeof startRelay>;
  let relay: string;
  let ch: Channel;
  let phone: Identity;
  const recording: Pusher = {
    send: async () => [],
    live: async (sends) => {
      pushed.push(...sends);
      return [];
    },
  };

  beforeAll(async () => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth(), pusher: recording });
    relay = server.url.origin;
    const owner = await generateIdentity("alice");
    phone = await generateIdentity("alice-phone");
    const made = await Channel.create(relay, owner, { name: "alice", kind: "human" }, [], undefined, "dev:alice");
    ch = new Channel(made.access, relay, owner);
    const ask = await Channel.requestJoin(relay, made.code, phone, { name: "alice-phone" });
    await ch.approve((await checked(ch, relay, made.code, [{ id: phone, requestId: ask.requestId }]))[0]!);
    const path = "/live-token";
    const text = JSON.stringify({ start: "5a".repeat(80) });
    const res = await fetch(`${relay}/v1/rooms/${ch.access.roomId}${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${await signRequest(phone, ch.access.roomId, "PUT", path, text)}` },
      body: text,
    });
    expect(res.status).toBe(200);
  });
  afterAll(() => {
    server.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a working agent starts the phone's Live Activity with a blob only the channel key opens", async () => {
    const about: LiveAbout = { name: "builder-one", face: "builder", color: "green", task: "T52 Relay", title: "channels" };
    const live = new LiveBlobs(relayLiveIo(ch, async () => about));
    await live.tick(working);
    await Bun.sleep(30);
    expect(pushed.map((s) => s.event)).toEqual(["start"]);
    const key = ch.access.keys[String(ch.access.epoch)]!;
    expect(await openLive(key, ch.access.roomId, pushed[0]!.blobs[0]!)).toEqual({ v: 1, n: "builder-one", f: "builder", c: "green", t: "T52 Relay", s: 1_000, h: "channels" });
    expect(JSON.stringify(pushed[0])).not.toContain("builder-one");
    await live.close();
  });
});
