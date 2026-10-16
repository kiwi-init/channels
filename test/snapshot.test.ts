import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../src/agent.ts";
import { signRequest } from "../src/auth.ts";
import { newChannelKey, type ChannelAccess } from "../src/crypto.ts";
import { canonical, generateIdentity, sign, verify, type Identity } from "../src/identity.ts";
import { MAX_SNAPSHOT_LENGTH, type Event, type Kind, type Message } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { openSnapshot, sealSnapshot } from "../src/snapshot.ts";
import { fold, toRoster, type ChannelState, type FoldBase, type GuardFloor, type Roster, type RoomsFloor } from "../src/state.ts";
import { setupChannel } from "./owner.ts";

const T0 = 1_700_000_000_000;
const NOW = T0 + 10_000_000;

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Floors = { mode: { coordinatorOnly: boolean; strict: boolean; since: number } | null; rooms: RoomsFloor | null; guard: GuardFloor | null };

function plain(x: unknown): unknown {
  if (x instanceof Map) return [...x].map(([k, v]) => [k, plain(v)]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  if (x instanceof Set) return [...x].map(String).sort();
  if (Array.isArray(x)) return x.map(plain);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined).map(([k, v]) => [k, plain(v)]));
  return x;
}

function capture(messages: Message[], roster: Roster, floors: Floors, n: number, from?: FoldBase | null): FoldBase {
  let base: FoldBase | null = null;
  fold(
    messages.filter((m) => m.seq <= n),
    roster,
    NOW,
    floors.mode,
    floors.rooms,
    floors.guard,
    from,
    (b) => {
      base = b;
    },
  );
  if (!base) throw new Error("no base");
  return base;
}

function same(a: ChannelState, b: ChannelState): void {
  expect([...a.members.keys()]).toEqual([...b.members.keys()]);
  expect(a.openAsks.map((m) => m.seq)).toEqual(b.openAsks.map((m) => m.seq));
  expect(plain(a)).toEqual(plain(b));
}

interface World {
  ids: Record<string, Identity>;
  roster: Roster;
  messages: Message[];
  floors: Floors;
}

async function world(count: number, seed: number): Promise<World> {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const names = ["own", "ann", "a1", "a2", "ro"] as const;
  const ids: Record<string, Identity> = {};
  for (const n of [...names, "ghost"]) ids[n] = await generateIdentity(n);
  const roster: Roster = [
    { name: "own", pk: ids.own!.pk, owner: true, at: T0, active: true, kind: "human", sponsor: { user: "u1", name: "Own" } },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: T0 + 1, active: true, kind: "human", sponsor: { user: "u2", name: "Ann" }, color: "red" },
    { name: "a1", pk: ids.a1!.pk, owner: false, at: T0 + 2, active: true, kind: "agent", sponsor: { user: "u1", name: "Own" } },
    { name: "a2", pk: ids.a2!.pk, owner: false, at: T0 + 3, active: true, kind: "agent", sponsor: { user: "u2", name: "Ann" } },
    { name: "ro", pk: ids.ro!.pk, owner: false, at: T0 + 4, active: true, kind: "agent", scopes: ["post"] },
  ];
  const messages: Message[] = [];
  const rooms: string[] = ["general"];
  const tasks: number[] = [];
  let seq = 0;
  let lastRoom = -1;
  let lastCharter: { text: string | null; since: number } | null = null;
  let lastHold: { on: boolean; note?: string; since: number } | null = null;
  let lastScope: { scopes: ("post" | "ask" | "tasks" | "claims" | "facts")[]; since: number } | null = null;
  let lastMode: { coordinatorOnly: boolean; strict: boolean; since: number } | null = null;
  const send = async (from: string, init: { kind?: Kind; ev?: Event; to?: string[]; re?: number[]; room?: string; task?: number; dm?: true; signer?: string }) => {
    seq++;
    const at = T0 + 1000 + seq * 1000;
    const p = {
      v: 1 as const,
      id: `m${seq}`,
      from,
      kind: init.kind ?? (init.ev ? "event" : "msg"),
      body: `body ${seq}`,
      ts: at,
      ...(init.to ? { to: init.to } : {}),
      ...(init.re ? { re: init.re } : {}),
      ...(init.ev ? { ev: init.ev } : {}),
      ...(init.room && init.room !== "general" ? { room: init.room } : {}),
      ...(init.task !== undefined ? { task: init.task } : {}),
      ...(init.dm ? { dm: init.dm } : {}),
    };
    const signed = await sign(ids[init.signer ?? from]!, p);
    messages.push({ ...signed, seq, rts: at, sigOk: await verify(signed) });
    return seq;
  };
  const chats = () => messages.filter((m) => m.kind !== "event").map((m) => m.seq);
  while (seq < count) {
    const who = pick(names);
    const roll = r();
    if (roll < 0.3) {
      const re = r() < 0.4 && chats().length ? [pick(chats())] : undefined;
      const dm = r() < 0.1;
      await send(who, {
        kind: pick(["msg", "msg", "ask", "blocking"] as const),
        to: dm ? [pick(names.filter((n) => n !== who))] : r() < 0.5 ? [pick(names)] : undefined,
        re,
        room: re ? undefined : pick(rooms),
        task: !re && !dm && tasks.length && r() < 0.3 ? pick(tasks) : undefined,
        dm: dm ? true : undefined,
      });
    } else if (roll < 0.4) {
      tasks.push(await send(who, { ev: { op: "task.add", title: `task ${seq}`, ...(r() < 0.3 ? { review: "*" } : {}), ...(r() < 0.3 ? { owner: pick(names) } : {}) } }));
    } else if (roll < 0.5 && tasks.length) {
      const task = pick(tasks);
      if (r() < 0.3) await send(who, { ev: { op: "task.claim", task } });
      else await send(who, { ev: { op: "task.update", task, state: pick(["doing", "review", "done", "cancelled", "blocked", "todo"] as const), ...(r() < 0.3 ? { note: "note" } : {}), ...(r() < 0.2 ? { verdict: pick(["approved", "rejected"] as const), round: 1 } : {}) } });
    } else if (roll < 0.58) {
      if (r() < 0.75) await send(who, { ev: { op: "fact.set", key: pick(["k1", "k2", "k3", "k4"]), value: `v${seq}`, ...(r() < 0.3 ? { ttl: pick([60, 100_000]) } : {}) } });
      else await send(who, { ev: { op: "fact.del", key: pick(["k1", "k2", "k3", "k4"]) } });
    } else if (roll < 0.66 && messages.length) {
      await send(who, { ev: { op: "react", seq: pick(messages).seq, emoji: r() < 0.8 ? pick(["👍", "👀", "🎉"]) : null } });
    } else if (roll < 0.7) {
      await send(who, { ev: { op: "card", runs: { harness: "claude" }, tools: ["Git", "bun "] } as Event });
    } else if (roll < 0.73) {
      await send(who, { body: "forged", signer: "ghost" } as never);
    } else if (roll < 0.75) {
      await send("ghost", {});
    } else if (roll < 0.78) {
      await send(pick(["ann", "own"]), { ev: { op: "color.set", member: pick(["ann", "own", "a1"]), color: r() < 0.8 ? pick(["red", "blue", "green"] as const) : null } });
    } else if (roll < 0.8) {
      await send(who, { ev: { op: "hello", role: "x", about: "y" } });
    } else {
      const k = Math.floor(r() * 9);
      if (k === 0) {
        const id = `r${seq}`;
        await send("own", { ev: { op: "room.create", id, name: `room ${seq}` } });
        rooms.push(id);
        lastRoom = seq;
      } else if (k === 1) {
        lastRoom = await send("own", { ev: { op: "room.rename", id: pick(rooms), name: `named ${seq}` } });
      } else if (k === 2) {
        const coordinatorOnly = r() < 0.5;
        const strict = r() < 0.5;
        lastMode = { coordinatorOnly, strict: coordinatorOnly && strict, since: await send("own", { ev: { op: "mode.set", coordinatorOnly, strict } }) };
      } else if (k === 3) {
        const text = r() < 0.7 ? `charter ${seq}` : null;
        lastCharter = { text, since: await send("own", { ev: { op: "charter.set", text } }) };
      } else if (k === 4) {
        const on = r() < 0.4;
        lastHold = { on, ...(on ? { note: "wait" } : {}), since: await send("own", { ev: { op: "hold.set", on, ...(on ? { note: "wait" } : {}) } }) };
      } else if (k === 5) {
        await send("own", { ev: { op: "role.set", member: pick(["a1", "a2"]), role: pick(["coordinator", "builder", null]), about: r() < 0.5 ? "rules" : undefined } });
      } else if (k === 6) {
        const scopes = pick([["post"], ["post", "ask", "tasks"], null] as const);
        const s = await send("own", { ev: { op: "scope.set", member: "ro", pk: ids.ro!.pk, scopes: scopes ? [...scopes] : null } });
        lastScope = { scopes: scopes ? [...scopes] : ["post", "ask", "tasks", "claims", "facts"], since: s };
      } else if (k === 7) {
        await send(who, { ev: { op: "room.create", id: `bad${seq}`, name: "not owner" } });
      } else {
        await send("own", { ev: { op: "seat.reclaim", member: "a1", from: "x", to: "y" } });
      }
    }
  }
  if (lastScope) roster[4] = { ...roster[4]!, later: lastScope };
  const full = fold(messages, roster, NOW);
  const list = [...full.rooms.values()].filter((x) => x.id !== "general" || x.name !== "general").map(({ id, name }) => ({ id, name }));
  return {
    ids,
    roster,
    messages,
    floors: {
      mode: lastMode,
      rooms: lastRoom > 0 ? { list, since: lastRoom } : null,
      guard: lastCharter || lastHold ? { charter: lastCharter, hold: lastHold } : null,
    },
  };
}

describe("a fold resumed from a snapshot folds to the same state as the whole log", () => {
  for (const seed of [1, 2, 3]) {
    test(`seed ${seed}: every cut point`, async () => {
      const w = await world(260, seed);
      const full = fold(w.messages, w.roster, NOW, w.floors.mode, w.floors.rooms, w.floors.guard);
      expect(full.tasks.size).toBeGreaterThan(5);
      for (let n = 1; n <= w.messages.length; n += 3) {
        const base = capture(w.messages, w.roster, w.floors, n);
        expect(base.n).toBe(n);
        const resumed = fold(w.messages, w.roster, NOW, w.floors.mode, w.floors.rooms, w.floors.guard, base);
        same(resumed, full);
      }
    });
  }

  test("a snapshot made from an older snapshot, and only the tail past each", async () => {
    const w = await world(200, 7);
    const full = fold(w.messages, w.roster, NOW, w.floors.mode, w.floors.rooms, w.floors.guard);
    const first = capture(w.messages, w.roster, w.floors, 60);
    const second = capture(w.messages.filter((m) => m.seq > 60), w.roster, w.floors, 140, first);
    expect(second).toEqual(capture(w.messages, w.roster, w.floors, 140));
    same(fold(w.messages.filter((m) => m.seq > 140), w.roster, NOW, w.floors.mode, w.floors.rooms, w.floors.guard, second), full);
  });

  test("with no settings floors (an agent's fold without the owner's signed settings)", async () => {
    const w = await world(150, 11);
    const none: Floors = { mode: null, rooms: null, guard: null };
    const full = fold(w.messages, w.roster, NOW);
    for (const n of [10, 75, 149]) same(fold(w.messages, w.roster, NOW, null, null, null, capture(w.messages, w.roster, none, n)), full);
  });

  test("a settings floor older than the snapshot doesn't undo what came after it", async () => {
    const w = await world(40, 9);
    const own = w.ids.own!;
    const at = (seq: number) => T0 + 1000 + seq * 1000;
    const event = async (seq: number, ev: Event): Promise<Message> => {
      const p = await sign(own, { v: 1 as const, id: `f${seq}`, from: "own", kind: "event" as const, body: "", ev, ts: at(seq) });
      return { ...p, seq, rts: at(seq), sigOk: true };
    };
    const log = [...w.messages, await event(41, { op: "mode.set", coordinatorOnly: true, strict: true }), await event(42, { op: "charter.set", text: "old" }), await event(43, { op: "mode.set", coordinatorOnly: false, strict: false }), await event(44, { op: "charter.set", text: "new" }), await event(45, { op: "hello" })];
    const floors: Floors = { mode: { coordinatorOnly: true, strict: true, since: 41 }, rooms: null, guard: { charter: { text: "old", since: 42 }, hold: null } };
    const full = fold(log, w.roster, NOW, floors.mode, floors.rooms, floors.guard);
    expect(full.mode.coordinatorOnly).toBe(false);
    expect(full.charter?.text).toBe("new");
    same(fold(log, w.roster, NOW, floors.mode, floors.rooms, floors.guard, capture(log, w.roster, floors, 44)), full);
  });

  test("members admitted or removed after the snapshot", async () => {
    const w = await world(120, 5);
    const late = await generateIdentity("a3");
    const at = T0 + 1000 + 121 * 1000;
    const later: Roster = [...w.roster.map((r) => (r.name === "a2" ? { ...r, active: false } : r)), { name: "a3", pk: late.pk, owner: false, at, active: true, kind: "agent" }];
    const base = capture(w.messages, w.roster, w.floors, 120);
    const p = await sign(late, { v: 1 as const, id: "late", from: "a3", kind: "msg" as const, body: "hi", ts: at });
    const tail: Message[] = [...w.messages, { ...p, seq: 121, rts: at, sigOk: true }];
    same(fold(tail, later, NOW, w.floors.mode, w.floors.rooms, w.floors.guard, base), fold(tail, later, NOW, w.floors.mode, w.floors.rooms, w.floors.guard));
  });
});

describe("sealed snapshots", () => {
  async function channel() {
    const w = await world(120, 21);
    const access: ChannelAccess = { roomId: "ab".repeat(16), ownerPk: w.ids.own!.pk, ownerXpk: "", epoch: 1, keys: { "0": newChannelKey(), "1": newChannelKey() } };
    return { w, access, base: capture(w.messages, w.roster, w.floors, 120) };
  }

  test("open what the owner sealed: the same base, byte for byte", async () => {
    const { w, access, base } = await channel();
    const sealed = await sealSnapshot(w.ids.own!, access, base);
    expect(sealed).not.toBeNull();
    expect(sealed!.e).toBe(1);
    const opened = await openSnapshot(access, sealed);
    expect(canonical(opened)).toBe(canonical(base));
    same(fold(w.messages, w.roster, NOW, w.floors.mode, w.floors.rooms, w.floors.guard, opened), fold(w.messages, w.roster, NOW, w.floors.mode, w.floors.rooms, w.floors.guard));
    const again = await sealSnapshot(w.ids.own!, access, opened!);
    expect(again!.hash).toBe(sealed!.hash);
  });

  test("only the owner's signature counts: a member's snapshot, sealed with the right key, is refused", async () => {
    const { w, access, base } = await channel();
    expect(await sealSnapshot(w.ids.a1!, access, base)).toBeNull();
    const forged = await sealSnapshot(w.ids.a1!, { ...access, ownerPk: w.ids.a1!.pk }, { ...base, facts: [{ key: "k", value: "evil", by: "own", ts: 1, seq: 1 }] });
    expect(forged).not.toBeNull();
    expect(await openSnapshot({ ...access, ownerPk: w.ids.a1!.pk }, forged)).not.toBeNull();
    expect(await openSnapshot(access, forged)).toBeNull();
  });

  test("anything the relay changes is refused", async () => {
    const { w, access, base } = await channel();
    const s = (await sealSnapshot(w.ids.own!, access, base))!;
    const other = (await sealSnapshot(w.ids.own!, access, capture(w.messages, w.roster, w.floors, 100)))!;
    expect(await openSnapshot(access, { ...s, n: s.n + 1 })).toBeNull();
    expect(await openSnapshot(access, { ...s, e: 0 })).toBeNull();
    expect(await openSnapshot(access, { ...s, hash: other.hash })).toBeNull();
    expect(await openSnapshot(access, { ...s, ct: other.ct, iv: other.iv })).toBeNull();
    expect(await openSnapshot(access, { ...s, sig: other.sig })).toBeNull();
    expect(await openSnapshot({ ...access, roomId: "cd".repeat(16) }, s)).toBeNull();
    expect(await openSnapshot({ ...access, keys: { "0": access.keys["0"]! } }, s)).toBeNull();
    expect(await openSnapshot(access, null)).toBeNull();
    expect(await openSnapshot(access, { ...s, ct: "" })).toBeNull();
    expect(await openSnapshot(access, s)).not.toBeNull();
  });
});

describe("the relay keeps one snapshot per channel", () => {
  test("the owner sets it within the cap, it counts toward the channel's bytes, and members read it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-snapshot-relay-"));
    const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir });
    try {
      const s = await setupChannel(server.url.origin);
      for (let i = 0; i < 5; i++) await s.ownerCh.send(`hello ${i}`);
      const { messages } = await s.ownerCh.history(0);
      const roster: Roster = (await s.ownerCh.members()).map((m) => ({ name: m.name, pk: m.pk, owner: m.owner, at: m.at, active: m.active, kind: m.kind }));
      let base: FoldBase | null = null;
      fold(messages, roster, NOW, null, null, null, null, (b) => {
        base = b;
      });
      expect(await runAgent(s.ownerCh.fx.snapshotAt())).toBeNull();
      expect(await runAgent(s.ownerCh.fx.snapshot())).toBeNull();
      const meta = (k: string) => {
        const d = new Database(join(dir, `${s.roomId}.sqlite`), { readonly: true });
        const row = d.query("SELECT v FROM meta WHERE k = ?").get(k) as { v: string };
        d.close();
        return JSON.parse(row.v) as { bytes: number; ct: string };
      };
      const before = meta("usage").bytes;
      expect(await runAgent(s.ownerCh.fx.putSnapshot(base!))).toBe(5);
      expect(meta("usage").bytes).toBe(before + meta("snapshot").ct.length);
      expect(await runAgent(s.ownerCh.fx.snapshotAt())).toBe(5);
      expect(canonical(await runAgent(s.ownerCh.fx.snapshot()))).toBe(canonical(base));
      const put = async (snapshot: unknown) => {
        const body = JSON.stringify({ snapshot });
        const res = await fetch(`${server.url.origin}/v1/rooms/${s.roomId}/snapshot`, {
          method: "PUT",
          headers: { "content-type": "application/json", authorization: `Bearer ${await signRequest(s.owner, s.roomId, "PUT", "/snapshot", body)}` },
          body,
        });
        return res.status;
      };
      const ok = { n: 5, e: 0, iv: "A".repeat(16), ct: "x", hash: "h".repeat(43), sig: "s".repeat(86) };
      expect(await put({ ...ok, ct: "x".repeat(MAX_SNAPSHOT_LENGTH + 1) })).toBe(400);
      expect(await put({ ...ok, n: 6 })).toBe(400);
      expect(await put({ ...ok, e: 1 })).toBe(400);
      expect(await put({ ...ok, sig: "short" })).toBe(400);
      expect(await put(ok)).toBe(200);
      expect(meta("usage").bytes).toBe(before + 1);
      expect(await runAgent(s.ownerCh.fx.snapshot())).toBeNull();
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the app's owner makes one from the relay's log when enough has happened since the last", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-snapshot-due-"));
    const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: dir });
    try {
      const s = await setupChannel(server.url.origin);
      const full = async () => {
        const { messages } = await s.ownerCh.history(0);
        return fold(messages, (await s.ownerCh.members()).map(toRoster), NOW, null, await s.ownerCh.rooms(), await s.ownerCh.guard());
      };
      for (let i = 0; i < 4; i++) await s.ownerCh.send(`one ${i}`, { kind: i % 2 ? "ask" : "msg" });
      expect(await runAgent(s.ownerCh.fx.snapshotIfDue(5))).toBeNull();
      expect(await runAgent(s.ownerCh.fx.snapshotIfDue(3))).toBe(4);
      expect(await runAgent(s.ownerCh.fx.snapshotIfDue(3))).toBeNull();
      for (let i = 0; i < 3; i++) await s.ownerCh.send(`two ${i}`, { ev: { op: "fact.set", key: `k${i}`, value: "v" } });
      expect(await runAgent(s.ownerCh.fx.snapshotIfDue(3))).toBe(7);
      const opened = await runAgent(s.ownerCh.fx.snapshot());
      expect(opened?.n).toBe(7);
      expect(opened?.facts.length).toBe(3);
      same(fold([], (await s.ownerCh.members()).map(toRoster), NOW, null, null, null, opened), await full());
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
