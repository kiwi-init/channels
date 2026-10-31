import { afterEach, describe, expect, test } from "bun:test";

import type { Member } from "@kiwi/core/membership.ts";
import { PROTOCOL_VERSION, SNAPSHOT_EVERY, SNAPSHOT_TOO_LARGE, type Message } from "@kiwi/core/protocol.ts";
import type { ChannelOps, FollowEvent } from "../../../desktop/src/bridge.ts";
import { ChannelLink } from "./channel-ops.ts";
import { APP_BEACON_MS, ChannelStore } from "./channel-store.ts";
import { PRESENCE_TTL } from "./online.ts";
import type { StoredMember } from "./store.ts";
import { dropWarm } from "./warm.ts";

const CODE = "mc2-store-test";
const ME = "pk-me";
const member: StoredMember = { code: CODE, identity: { name: "me", pk: ME }, access: { roomId: "room-1", ownerPk: "pk-owner" } as StoredMember["access"], at: 0 };
const msg = (seq: number): Message => ({ v: PROTOCOL_VERSION, id: `id-${seq}`, from: "atlas", kind: "msg", body: `m${seq}`, ts: 1_700_000_000_000 + seq, seq, sigOk: true });
const person = (name: string, pk: string): Member => ({ name, pk, xpk: `x${pk}`, owner: false, at: 0, active: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ok(); i++) await sleep(1);
  expect(ok()).toBe(true);
}

type Answer = (...args: unknown[]) => unknown;

function relay(head = 0, opts: { owner?: boolean; answers?: Record<string, Answer> } = {}) {
  let roster: Member[] = [person("atlas", "pk-atlas")];
  const follows: { since: number; on: (e: FollowEvent) => void; stopped: boolean }[] = [];
  const lent = { emitted: [] as string[], released: 0 };
  const calls: { op: string; args: unknown[] }[] = [];
  const kept: { at: number; state: object }[] = [];
  const beacons: { client: string; query?: boolean }[] = [];
  const answers: Record<string, Answer> = {
    head: () => head,
    members: () => roster,
    requests: () => [],
    rotateIfDue: () => false,
    snapshot: () => null,
    snapshotIfDue: () => null,
    snapshotAt: () => null,
    title: () => null,
    guard: () => null,
    rooms: () => null,
    reconcilePosting: () => [],
    send: () => head + 1,
    drainGithub: () => undefined,
    syncGithubRules: () => undefined,
    syncGithubReleases: () => undefined,
    ...opts.answers,
  };
  const ops = {
    call: async (_code: string, op: string, ...args: unknown[]) => {
      calls.push({ op, args });
      return (await answers[op]?.(...args)) ?? null;
    },
    presence: (_code: string, p: { client: string; query?: boolean }) => {
      beacons.push(p);
      return Promise.resolve();
    },
    openRows: () => Promise.resolve([]),
    keep: (_code: string, state: object) => {
      kept.push({ at: Date.now(), state });
      return Promise.resolve(null);
    },
    openKept: () => Promise.resolve(null),
    nudge: () => {},
    follow: (_code: string, since: number, on: (e: FollowEvent) => void) => {
      const f = { since, on, stopped: false };
      follows.push(f);
      return () => {
        f.stopped = true;
      };
    },
  } as unknown as ChannelOps;
  const link = new ChannelLink(CODE, "room-1", ME, opts.owner ? ME : "pk-owner", ops);
  const lend = () => ({ emit: (e: { _tag: string }) => void lent.emitted.push(e._tag), release: () => void lent.released++ });
  const live = () => follows.at(-1)!;
  const say = (e: FollowEvent) => live().on(e);
  let rosterAt = 0;
  const setRoster = (next: Member[]) => {
    rosterAt = Date.now();
    roster = next;
  };
  const changedAt = () => rosterAt;
  const called = (op: string) => calls.filter((c) => c.op === op);
  return { link, lend, follows, lent, live, say, setRoster, changedAt, called, kept, beacons };
}

const opened = async (r: ReturnType<typeof relay>, human?: null) => {
  const store = new ChannelStore(member, human, { link: r.link, lend: r.lend });
  const close = store.open();
  if (human !== null) await until(() => r.follows.length > 0);
  return { store, close };
};

afterEach(() => dropWarm(CODE));

describe("a channel store", () => {
  test("follows from the relay's head once open, and goes live on the relay's Open", async () => {
    const r = relay(0);
    const { store, close } = await opened(r);
    expect(r.live().since).toBe(0);
    expect(store.handle.value.connection).toBe("connecting");
    expect(store.handle.value.ready).toBe(true);
    r.say({ _tag: "Open" });
    expect(store.handle.value.connection).toBe("live");
    r.say({ _tag: "Down" });
    expect(store.handle.value.connection).toBe("reconnecting");
    close();
  });

  test("messages heard together land in one 30 ms batch, fold into state, and notify once", async () => {
    const r = relay(0);
    const { store, close } = await opened(r);
    let notified = 0;
    const stop = store.subscribe(() => notified++);
    for (const seq of [1, 2, 3]) r.say({ _tag: "Message", message: msg(seq), row: null });
    expect(store.handle.value.messages).toHaveLength(0);
    await sleep(40);
    expect(store.handle.value.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(store.handle.value.state.head).toBe(3);
    expect(notified).toBe(1);
    expect(r.lent.emitted).toContain("Head");
    stop();
    close();
  });

  test("a read mark changes the handle but keeps the folded state: nothing refolds", async () => {
    const r = relay(0);
    const { store, close } = await opened(r);
    r.say({ _tag: "Message", message: msg(1), row: null });
    await sleep(40);
    const before = store.handle.value;
    r.say({ _tag: "Read", reads: [{ pk: "pk-atlas", seq: 1, at: 1 }], snapshot: false });
    const after = store.handle.value;
    expect(after).not.toBe(before);
    expect(after.state).toBe(before.state);
    close();
  });

  test("pkOf keeps its identity through new messages and changes when the roster does", async () => {
    const r = relay(0);
    const { store, close } = await opened(r);
    const pkOf = store.handle.value.pkOf;
    expect(pkOf("atlas")).toBe("pk-atlas");
    r.say({ _tag: "Message", message: msg(1), row: null });
    await sleep(40);
    expect(store.handle.value.pkOf).toBe(pkOf);
    r.setRoster([person("atlas", "pk-atlas"), person("nova", "pk-nova")]);
    r.say({ _tag: "Roster" });
    await until(() => store.handle.value.roster.length === 2);
    expect(store.handle.value.pkOf).not.toBe(pkOf);
    expect(store.handle.value.pkOf("nova")).toBe("pk-nova");
    close();
  });

  test("closing stops the follow, gives the watch back, and drops a batch still pending", async () => {
    const r = relay(0);
    const { store, close } = await opened(r);
    r.say({ _tag: "Message", message: msg(1), row: null });
    close();
    await sleep(40);
    expect(r.live().stopped).toBe(true);
    expect(r.lent.released).toBe(1);
    expect(store.handle.value.messages).toHaveLength(0);
  });

  test("the next store for the channel paints the warm window at once and follows past it", async () => {
    const r = relay(0);
    const first = await opened(r);
    for (const seq of [1, 2]) r.say({ _tag: "Message", message: msg(seq), row: null });
    await sleep(40);
    first.close();
    const again = relay(2);
    const store = new ChannelStore(member, undefined, { link: again.link, lend: again.lend });
    expect(store.handle.value.ready).toBe(true);
    expect(store.handle.value.messages.map((m) => m.seq)).toEqual([1, 2]);
    const close = store.open();
    await until(() => again.follows.length > 0);
    expect(again.live().since).toBe(2);
    close();
  });

  test("with the sign-in known to be gone, it never follows", async () => {
    const r = relay(0);
    const { close } = await opened(r, null);
    await sleep(10);
    expect(r.follows).toHaveLength(0);
    close();
  });

  test("past the history window plus slack, the oldest messages fold into a base and the state stays whole", async () => {
    const r = relay(0);
    const { store, close } = await opened(r);
    const all = Array.from({ length: 2_600 }, (_, i) => msg(i + 1));
    for (const m of all) r.say({ _tag: "Message", message: m, row: null });
    await sleep(40);
    await until(() => store.handle.value.messages.length < all.length);
    const { messages, state } = store.handle.value;
    expect(messages.at(-1)?.seq).toBe(2_600);
    expect(messages.length).toBeGreaterThanOrEqual(2_000);
    expect(messages[0]!.seq).toBeGreaterThan(1);
    expect(state.head).toBe(2_600);
    close();
  });

  test("short of the slack, nothing is trimmed", async () => {
    const r = relay(0);
    const { store, close } = await opened(r);
    for (let seq = 1; seq <= 2_400; seq++) r.say({ _tag: "Message", message: msg(seq), row: null });
    await sleep(60);
    expect(store.handle.value.messages).toHaveLength(2_400);
    close();
  });
});

describe("the sealed keep", () => {
  test("a change inside the 3 s window restarts it: one seal, 3 s after the change, with the latest roster", async () => {
    const r = relay(0);
    const { store, close } = await opened(r);
    await sleep(1_000);
    r.setRoster([person("atlas", "pk-atlas"), person("nova", "pk-nova")]);
    r.say({ _tag: "Roster" });
    await until(() => store.handle.value.roster.length === 2);
    await sleep(3_400);
    const after = r.kept.filter((k) => k.at >= r.changedAt());
    expect(after).toHaveLength(1);
    expect(after[0]!.at - r.changedAt()).toBeGreaterThanOrEqual(2_990);
    expect(JSON.stringify(after[0]!.state)).toContain("pk-nova");
    close();
  }, 10_000);

  test("closing before the delay seals nothing", async () => {
    const r = relay(0);
    const { close } = await opened(r);
    close();
    await sleep(3_300);
    expect(r.kept).toHaveLength(0);
  }, 10_000);
});

describe("snapshots", () => {
  const upTo = (r: ReturnType<typeof relay>, head: number) => {
    for (let seq = 1; seq <= head; seq++) r.say({ _tag: "Message", message: msg(seq), row: null });
  };

  test("the owner asks for one when the head reaches the next try, and not again before the one after", async () => {
    const r = relay(0, { owner: true, answers: { snapshotIfDue: () => SNAPSHOT_EVERY } });
    const { close } = await opened(r);
    upTo(r, SNAPSHOT_EVERY - 1);
    await sleep(40);
    expect(r.called("snapshotIfDue")).toHaveLength(0);
    r.say({ _tag: "Message", message: msg(SNAPSHOT_EVERY), row: null });
    await until(() => r.called("snapshotIfDue").length === 1);
    r.say({ _tag: "Message", message: msg(SNAPSHOT_EVERY + 1), row: null });
    await sleep(40);
    expect(r.called("snapshotIfDue")).toHaveLength(1);
    close();
  });

  test("a snapshot too large to seal stops the tries and says so", async () => {
    const r = relay(0, { owner: true, answers: { snapshotIfDue: () => Promise.reject(new Error(`relay: ${SNAPSHOT_TOO_LARGE}`)) } });
    const { store, close } = await opened(r);
    upTo(r, SNAPSHOT_EVERY);
    await until(() => store.handle.value.snapshotTooBig);
    upTo(r, SNAPSHOT_EVERY * 3);
    await sleep(40);
    expect(r.called("snapshotIfDue")).toHaveLength(1);
    close();
  });

  test("a member who isn't the owner never asks", async () => {
    const r = relay(0);
    const { close } = await opened(r);
    upTo(r, SNAPSHOT_EVERY);
    await sleep(40);
    expect(r.called("snapshotIfDue")).toHaveLength(0);
    close();
  });
});

describe("the GitHub chores", () => {
  const withRepo = { guard: () => ({ charter: null, hold: null, repos: { list: ["acme/app"], since: 0 } }) };

  test("once caught up with a linked repo, the owner syncs its rules, then its releases", async () => {
    const r = relay(0, { owner: true, answers: withRepo });
    const { store, close } = await opened(r);
    r.say({ _tag: "Message", message: msg(1), row: null });
    await until(() => store.handle.value.state.repos.length === 1);
    await until(() => r.called("syncGithubReleases").length === 1);
    expect(r.called("syncGithubRules")).toHaveLength(1);
    expect(r.called("syncGithubRules")[0]!.args[0]).toEqual(["acme/app"]);
    close();
  });

  test("a store opened on a warm window with a repo drains the GitHub queue at once", async () => {
    const first = relay(0, { owner: true, answers: withRepo });
    const warm = await opened(first);
    first.say({ _tag: "Message", message: msg(1), row: null });
    await until(() => warm.store.handle.value.state.repos.length === 1);
    warm.close();
    const r = relay(1, { owner: true, answers: withRepo });
    const store = new ChannelStore(member, undefined, { link: r.link, lend: r.lend });
    const close = store.open();
    await until(() => r.called("drainGithub").length === 1);
    close();
  });

  test("a member who isn't the owner runs none of them", async () => {
    const r = relay(0, { answers: withRepo });
    const { store, close } = await opened(r);
    r.say({ _tag: "Message", message: msg(1), row: null });
    await until(() => store.handle.value.state.repos.length === 1);
    await sleep(40);
    expect(r.called("drainGithub")).toHaveLength(0);
    expect(r.called("syncGithubRules")).toHaveLength(0);
    expect(r.called("syncGithubReleases")).toHaveLength(0);
    close();
  });
});

describe("a person's own presence (T560)", () => {
  const probe = (from: string): FollowEvent => ({
    _tag: "Presence",
    presence: { v: PROTOCOL_VERSION, type: "presence", from, client: "probe", query: true, ts: Date.now(), pk: `pk-${from}`, sigOk: true },
  });

  test("going live, the app asks who's here and says it's here itself, so other people see it online", async () => {
    const r = relay(0);
    const { close } = await opened(r);
    r.say({ _tag: "Open" });
    expect(r.beacons).toEqual([{ client: "probe", query: true }, { client: "app" }]);
    close();
  });

  test("someone else asking who's here gets an answer, once for a burst of asks, and never from a closed store", async () => {
    const r = relay(0);
    const { close } = await opened(r);
    r.say({ _tag: "Open" });
    r.beacons.length = 0;
    await sleep(600);
    r.say(probe("ana"));
    r.say(probe("bo"));
    expect(r.beacons).toEqual([{ client: "app" }]);
    close();
    await sleep(600);
    r.say(probe("ana"));
    expect(r.beacons).toEqual([{ client: "app" }]);
  });

  test("it says so again well before others forget it", () => {
    expect(APP_BEACON_MS * 2).toBeLessThan(PRESENCE_TTL);
  });
});
