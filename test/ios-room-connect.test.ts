import { beforeAll, describe, expect, test } from "bun:test";

import { openKept, openRows, packEnvelope, packKept, type CachedRow } from "@kiwi/core/cache-row.ts";
import { received } from "@kiwi/core/client/history.ts";
import { newChannelKey, seal } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type FoldBase } from "@kiwi/core/state.ts";

import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import type { Keyring } from "../desktop/src/keyring.ts";
import { Room, type Held } from "../ios/engine/room.ts";
import type { RoomView } from "../ios/engine/wire.ts";

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function roomOn(head: number, offlineTries: number) {
  const seen = { heads: 0, follows: 0, views: [] as RoomView[] };
  let offline = offlineTries;
  const keyring = {
    call: async (_code: string, op: string): Promise<unknown> => {
      if (op === "head") {
        seen.heads += 1;
        if (offline > 0) {
          offline -= 1;
          throw new Error("the relay can't be reached");
        }
        return head;
      }
      if (op === "members") return [];
      return null;
    },
    follow: (): (() => void) => {
      seen.follows += 1;
      return () => {};
    },
  } as unknown as Keyring;
  const seat = { code: "code", label: "me", name: "general", pk: "pk", access: {} } as unknown as ChannelIdentityView;
  const room = new Room(keyring, seat, {
    emit: (view) => void seen.views.push(view),
    lost: () => {},
    person: () => null,
    log: () => {},
    devices: () => {},
  });
  return { room, seen };
}

describe("a phone room connects whatever the network did first (T948)", () => {
  test("offline at start, it tries again and follows the channel", async () => {
    const { room, seen } = roomOn(10, 1);
    await room.start();
    expect(seen.follows).toBe(0);
    await wait(700);
    expect(seen.heads).toBe(2);
    expect(seen.follows).toBe(1);
    room.stop();
  });

  test("coming back to the app tries at once", async () => {
    const { room, seen } = roomOn(10, 1);
    await room.start();
    room.nudge();
    await wait(50);
    expect(seen.follows).toBe(1);
    room.stop();
  });

  test("a stopped room stops trying", async () => {
    const { room, seen } = roomOn(10, 1);
    await room.start();
    room.stop();
    await wait(700);
    expect(seen.heads).toBe(1);
    expect(seen.follows).toBe(0);
  });

  test("a room that loaded only the channel's tail doesn't claim its start", async () => {
    const short = roomOn(10, 0);
    await short.room.start();
    await wait(100);
    expect(short.seen.views.at(-1)?.whole).toBe(true);
    short.room.stop();
    const long = roomOn(5_000, 0);
    await long.room.start();
    await wait(100);
    expect(long.seen.views.at(-1)?.whole).toBe(false);
    long.room.stop();
  });
});

describe("a phone room sends into a named room (#437)", () => {
  test("a send from room:<id> carries the room, and one for a room it can't see is refused", async () => {
    const sent: { body: string; opts: Record<string, unknown> }[] = [];
    let hear: (ev: unknown) => void = () => {};
    const me = { name: "me", pk: "pk", owner: true, at: 0, active: true, kind: "human" };
    const keyring = {
      call: async (_code: string, op: string, ...args: unknown[]): Promise<unknown> => {
        if (op === "head") return 1;
        if (op === "members") return [me];
        if (op === "send") {
          sent.push({ body: args[0] as string, opts: args[1] as Record<string, unknown> });
          return 2;
        }
        return null;
      },
      follow: (_code: string, _since: number, on: (ev: unknown) => void): (() => void) => {
        hear = on;
        return () => {};
      },
      presence: async () => null,
    } as unknown as Keyring;
    const seat = { code: "code", label: "me", idName: "me", name: "general", pk: "pk", access: { ownerPk: "pk" } } as unknown as ChannelIdentityView;
    const room = new Room(keyring, seat, { emit: () => {}, lost: () => {}, person: () => null, log: () => {}, devices: () => {} });
    await room.start();
    hear({
      _tag: "Message",
      message: { v: 1, id: "c", seq: 1, ts: 1, rts: 1, from: "me", pk: "pk", sig: "", sigOk: true, kind: "event", body: "", ev: { op: "room.create", id: "design01", name: "design" } },
    });
    await wait(100);
    expect(await room.send("mockups?", null, [], "room:design01")).toBe(2);
    expect(sent[0]?.opts).toMatchObject({ kind: "msg", room: "design01" });
    await expect(room.send("hi", null, [], "room:nope0001")).rejects.toThrow("that room isn't open to you");
    room.stop();
  });
});

const KEY = newChannelKey();
const ROOM_ID = "room-t1028";
const KEYS = { "0": KEY };
const T0 = 1_700_000_000_000;

interface Logged {
  message: Message;
  row: CachedRow;
}

let people: Record<string, Identity> = {};
let roster: Member[] = [];
let log: Logged[] = [];

const bodyOf = (seq: number): string => `message ${seq} says the build for T${seq} is green`;

async function channelLog(n: number): Promise<Logged[]> {
  const out: Logged[] = [];
  for (let seq = 1; seq <= n; seq++) {
    const from = seq % 3 ? "lead" : "jow";
    const ts = T0 + seq * 1_000;
    const ev: Event | null =
      seq % 40 === 1
        ? { op: "task.add", title: `ship part ${seq}`, owner: "lead", review: "jow" }
        : seq % 40 === 20
          ? { op: "task.update", task: seq - 19, state: "review", at: `sha${seq}` }
          : seq % 13 === 0
            ? { op: "react", seq: seq - 1, emoji: "👍" }
            : null;
    const draft = ev
      ? { v: 1 as const, id: crypto.randomUUID(), ts, from, kind: "event" as const, body: "", ev }
      : { v: 1 as const, id: crypto.randomUUID(), ts, from, kind: "msg" as const, body: bodyOf(seq) };
    const p = await sign(people[from]!, draft);
    const env = { seq, ts, e: 0, ...(await seal(KEY, ROOM_ID, p)) };
    out.push({ message: received(p, seq, ts, await verify(p)), row: await packEnvelope(KEY, ROOM_ID, 0, env) });
  }
  return out;
}

function snapshotAt(n: number): FoldBase | null {
  let base: FoldBase | null = null;
  fold(
    log.slice(0, n).map((l) => l.message),
    roster,
    Date.now(),
    null,
    null,
    null,
    (b) => (base = b),
  );
  return base;
}

interface Phone {
  head: number;
  upto?: number;
  offline?: number;
  keys?: Record<string, string>;
}

function phoneOn(p: Phone) {
  const seen = { follows: [] as number[], snapshots: 0, opened: 0, lines: [] as string[], states: [] as ChannelState[] };
  let offline = p.offline ?? 0;
  const keys = p.keys ?? KEYS;
  const keyring = {
    call: async (_code: string, op: string): Promise<unknown> => {
      if (op === "head") {
        if (offline-- > 0) throw new Error("the relay can't be reached");
        return p.head;
      }
      if (op === "members") return roster;
      if (op === "snapshot") {
        seen.snapshots += 1;
        return snapshotAt(Math.max(0, p.head - 400));
      }
      return null;
    },
    follow: (_code: string, since: number, on: (ev: unknown) => void): (() => void) => {
      seen.follows.push(since);
      queueMicrotask(() => {
        on({ _tag: "Open" });
        for (const l of log.slice(since, p.upto ?? p.head)) on({ _tag: "Message", message: l.message, row: l.row });
      });
      return () => {};
    },
    presence: async () => null,
    keep: (_code: string, state: object) => packKept(KEY, ROOM_ID, 0, state),
    openKept: (_code: string, sealed: unknown) => openKept(sealed, ROOM_ID, keys),
    openRows: (_code: string, rows: unknown[]) => {
      seen.opened += 1;
      return openRows(rows, ROOM_ID, keys);
    },
  } as unknown as Keyring;
  const seat = { code: "code", label: "jow", idName: "jow", name: "general", pk: people.jow!.pk, access: {} } as unknown as ChannelIdentityView;
  const room = new Room(keyring, seat, {
    emit: () => {},
    lost: () => {},
    person: () => null,
    log: (line) => void seen.lines.push(line),
    devices: () => {},
    needs: (state) => (seen.states.push(state), []),
  });
  return { room, seen };
}

async function keptAt(p: Phone): Promise<Held> {
  const { room } = phoneOn(p);
  await room.start();
  await wait(150);
  const held = await room.held();
  room.stop();
  if (!held) throw new Error("the phone kept nothing");
  return held;
}

async function settled(p: Phone, kept?: unknown) {
  const phone = phoneOn(p);
  await phone.room.start(kept);
  await wait(150);
  phone.room.stop();
  return phone.seen;
}

describe("a cold phone launch fetches only what's new (T1028)", () => {
  beforeAll(async () => {
    people = { jow: await generateIdentity("jow"), lead: await generateIdentity("lead") };
    roster = [
      { name: "jow", pk: people.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
      { name: "lead", pk: people.lead!.pk, owner: false, at: 0, active: true, kind: "agent", role: "lead" },
    ] as Member[];
    log = await channelLog(470);
  });

  test("kept rows resume from the last seq, with no snapshot, and fold to what a full fetch gives", async () => {
    const kept = await keptAt({ head: 440 });
    const resumed = await settled({ head: 470 }, kept);
    expect(resumed.follows).toEqual([440]);
    expect(resumed.snapshots).toBe(0);
    expect(resumed.opened).toBe(1);
    const full = await settled({ head: 470 });
    expect(full.follows).toEqual([70]);
    expect(full.snapshots).toBe(1);
    expect(resumed.states.at(-1)).toEqual(full.states.at(-1)!);
    expect(resumed.states.at(-1)!.tasks.size).toBeGreaterThan(5);
  });

  test("a phone that held more than the window keeps the newest rows over a folded base, and still folds the same", async () => {
    const kept = await keptAt({ head: 420, upto: 460 });
    expect(kept.rows.length).toBe(400);
    expect(kept.rows[0]!.seq).toBe(61);
    const resumed = await settled({ head: 470 }, kept);
    expect(resumed.follows).toEqual([460]);
    expect(resumed.snapshots).toBe(0);
    const full = await settled({ head: 470 });
    expect(resumed.states.at(-1)).toEqual(full.states.at(-1)!);
  });

  test("a gap wider than the window goes back to the window and a snapshot", async () => {
    const kept = await keptAt({ head: 60 });
    const seen = await settled({ head: 470 }, kept);
    expect(seen.follows).toEqual([70]);
    expect(seen.snapshots).toBe(1);
    expect(seen.lines).toEqual([]);
  });

  test("nothing kept, or the old view-only blob, loads the window and a snapshot", async () => {
    for (const kept of [undefined, { view: { e: 0, iv: "x", ct: "y" } }]) {
      const seen = await settled({ head: 470 }, kept);
      expect(seen.follows).toEqual([70]);
      expect(seen.snapshots).toBe(1);
      expect(seen.opened).toBe(0);
    }
  });

  test("rows that are damaged or sealed with keys this phone no longer holds are dropped", async () => {
    const kept = await keptAt({ head: 440 });
    const damaged = { ...kept, rows: kept.rows.map((r, i) => (i === 7 ? { ...r, ct: `${r.ct.slice(0, -4)}AAAA` } : r)) };
    const moved = { ...kept, rows: kept.rows.map((r, i) => (i === 3 ? { ...r, seq: r.seq + 1 } : r)) };
    const garbled = { ...kept, resume: { e: 0, iv: "nope", ct: "nope" } };
    for (const [bad, keys] of [
      [damaged, KEYS],
      [moved, KEYS],
      [garbled, KEYS],
      [kept, { "0": newChannelKey() }],
    ] as const) {
      const seen = await settled({ head: 470, keys }, bad);
      expect(seen.follows).toEqual([70]);
      expect(seen.snapshots).toBe(1);
      expect(seen.lines).toEqual(["a channel's kept history didn't open, so it loads from the relay again"]);
    }
  });

  test("a retry inside connect resumes from the rows it already opened", async () => {
    const kept = await keptAt({ head: 440 });
    const phone = phoneOn({ head: 470, offline: 1 });
    await phone.room.start(kept);
    expect(phone.seen.follows).toEqual([]);
    await wait(700);
    phone.room.stop();
    expect(phone.seen.follows).toEqual([440]);
    expect(phone.seen.snapshots).toBe(0);
    expect(phone.seen.opened).toBe(1);
  });

  test("what the phone hands over to keep is sealed: no message text in it", async () => {
    const kept = JSON.stringify(await keptAt({ head: 440 }));
    for (const seq of [41, 200, 439]) expect(kept).not.toContain(bodyOf(seq));
    expect(kept).not.toContain("ship part");
    expect(kept).not.toContain(people.lead!.pk);
  });
});
