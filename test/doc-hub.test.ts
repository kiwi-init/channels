import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { b64url, newChannelKey, newRoomId, open, seal } from "@kiwi/core/crypto.ts";
import { appendToBlock, blocksOf, newBlock, newDocId } from "@kiwi/core/doc/blocks.ts";
import { DocHub, type DocStore, type ThreadKeys } from "@kiwi/core/doc/hub.ts";
import { docKeysFor, docThread, privateRoomOf, type RoomsHere } from "@kiwi/core/doc/threads.ts";
import type { DocOut, DocSaved } from "@kiwi/core/doc/thread-doc.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { fileDocStore } from "@kiwi/core/node/doc-store.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";

interface Row {
  th: string;
  dseq: number;
  iv: string;
  ct: string;
  e?: number;
  snap?: true;
}

class Relay {
  rows: Row[] = [];
  heads = new Map<string, number>();
  ephs: string[] = [];
  snaps: string[] = [];
  private subs = new Map<Socket, Set<string>>();

  connect(): Socket {
    const s = new Socket(this);
    this.subs.set(s, new Set());
    return s;
  }

  hang(s: Socket): void {
    this.subs.delete(s);
  }

  frame(from: Socket, raw: string): void {
    const f = JSON.parse(raw) as DocOut | { t: "eph"; iv: string; ct: string };
    if (!this.subs.has(from)) return;
    if (f.t === "eph") {
      this.ephs.push(raw);
      for (const s of this.subs.keys()) if (s !== from) s.deliver(raw);
      return;
    }
    if (f.t === "doc.sub") {
      this.subs.get(from)!.add(f.th);
      for (const r of this.rows) if (r.th === f.th && r.dseq > f.since) from.deliver(JSON.stringify({ t: "doc", ...r, ts: 0 }));
      from.deliver(JSON.stringify({ t: "doc.ready", th: f.th, head: this.heads.get(f.th) ?? 0 }));
      return;
    }
    if (f.t === "doc.unsub") {
      this.subs.get(from)?.delete(f.th);
      return;
    }
    if (f.t === "doc.snap") {
      this.snaps.push(f.th);
      this.rows = [{ th: f.th, dseq: f.upto, iv: f.iv, ct: f.ct, ...(f.e === undefined ? {} : { e: f.e }), snap: true }, ...this.rows.filter((r) => r.th !== f.th || r.dseq > f.upto)];
      return;
    }
    const dseq = (this.heads.get(f.th) ?? 0) + 1;
    this.heads.set(f.th, dseq);
    const row: Row = { th: f.th, dseq, iv: f.iv, ct: f.ct, ...(f.e === undefined ? {} : { e: f.e }) };
    this.rows.push(row);
    from.deliver(JSON.stringify({ t: "ack", id: f.id, seq: dseq }));
    for (const [s, ths] of this.subs) if (s !== from && ths.has(f.th)) s.deliver(JSON.stringify({ t: "doc", ...row, ts: 0 }));
  }
}

class Socket {
  hub: DocHub | null = null;
  onEph: ((raw: string) => void) | null = null;
  private inbox: string[] = [];
  constructor(private readonly relay: Relay) {}
  send = (raw: string) => this.relay.frame(this, raw);
  deliver(raw: string): void {
    this.inbox.push(raw);
  }
  pump(): number {
    const got = this.inbox.splice(0);
    for (const raw of got) {
      const f = JSON.parse(raw) as { t: string; iv?: string; ct?: string };
      if (f.t === "eph") this.onEph?.(raw);
      else this.hub?.take(f);
    }
    return got.length;
  }
}

function memoryStore(): DocStore & { kept: Map<string, DocSaved> } {
  const kept = new Map<string, DocSaved>();
  return { kept, load: async (th) => kept.get(th) ?? null, save: async (th, s) => void kept.set(th, s) };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

async function world() {
  const roomId = newRoomId();
  const key = newChannelKey();
  const relay = new Relay();
  const announced: [string, string][] = [];
  const hubFor = (me: Identity, store: DocStore | null = null, keysFor?: ConstructorParameters<typeof DocHub>[0]["keysFor"]) =>
    new DocHub({
      roomId,
      me,
      store,
      keysFor: keysFor ?? (() => ({ current: async () => ({ key, e: 1 }), opening: async (e) => (e === 1 ? [key] : []) })),
      sealAware: (p) => seal(key, roomId, p),
      announce: async (thread, th) => void announced.push([thread, th]),
      flushMs: 1,
      awareMs: 1,
      saveMs: 1,
    });
  const plug = (hub: DocHub) => {
    const s = relay.connect();
    s.hub = hub;
    s.onEph = (raw) => {
      const f = JSON.parse(raw) as { iv: string; ct: string };
      void open(key, roomId, f.iv, f.ct).then((p) => hub.awareIn(p));
    };
    const unplug = hub.attach(s.send);
    return { s, unplug };
  };
  const settle = async (...ss: Socket[]) => {
    for (let i = 0; i < 20; i++) {
      await tick();
      if (ss.map((s) => s.pump()).every((n) => n === 0) && i > 3) return;
    }
  };
  return { relay, announced, hubFor, plug, settle, key, roomId };
}

const texts = (doc: Parameters<typeof blocksOf>[0]) => blocksOf(doc).map((b) => b.text);

describe("the doc hub keeps each thread's doc on the live socket", () => {
  test("the first to open a thread announces a new doc id; the others open that id and edits meet", async () => {
    const w = await world();
    const [ana, bo] = await Promise.all([generateIdentity("ana"), generateIdentity("bo")]);
    const a = w.hubFor(ana);
    const b = w.hubFor(bo);
    const sa = w.plug(a).s;
    const sb = w.plug(b).s;
    const da = await a.open("T7");
    expect(w.announced).toEqual([["T7", da.th]]);
    const db = await b.open("T7", da.th);
    await w.settle(sa, sb);
    newBlock(da.doc, "text", "ana", "from ana");
    newBlock(db.doc, "text", "bo", "from bo");
    await w.settle(sa, sb);
    expect(texts(da.doc).sort()).toEqual(["from ana", "from bo"]);
    expect(texts(db.doc)).toEqual(texts(da.doc));
    expect(await b.open("T7")).toBe(db);
  });

  test("cursors for every open doc go out together, at most once per window, and land in the other's awareness", async () => {
    const w = await world();
    const [ana, bo] = await Promise.all([generateIdentity("ana"), generateIdentity("bo")]);
    const a = w.hubFor(ana);
    const b = w.hubFor(bo);
    const sa = w.plug(a).s;
    const sb = w.plug(b).s;
    const one = await a.open("T1");
    const two = await a.open("T2");
    const bone = await b.open("T1", one.th);
    const btwo = await b.open("T2", two.th);
    one.awareness.setLocalStateField("user", { name: "ana" });
    two.awareness.setLocalStateField("user", { name: "ana" });
    await w.settle(sa, sb);
    expect(w.relay.ephs.length).toBe(1);
    expect(bone.awareness.getStates().get(one.doc.clientID)).toEqual({ user: { name: "ana" } });
    expect(btwo.awareness.getStates().get(two.doc.clientID)).toEqual({ user: { name: "ana" } });
    a.closeAll();
    b.closeAll();
  });

  test("edits made while the socket is down go out when it comes back", async () => {
    const w = await world();
    const [ana, bo] = await Promise.all([generateIdentity("ana"), generateIdentity("bo")]);
    const a = w.hubFor(ana);
    const b = w.hubFor(bo);
    const pa = w.plug(a);
    const sb = w.plug(b).s;
    const da = await a.open("T3");
    const db = await b.open("T3", da.th);
    await w.settle(pa.s, sb);
    w.relay.hang(pa.s);
    pa.unplug();
    const blk = newBlock(da.doc, "text", "ana", "typed");
    appendToBlock(da.doc, blk.id, " offline");
    await w.settle(pa.s, sb);
    expect(texts(db.doc)).toEqual([]);
    const back = w.plug(a).s;
    await w.settle(back, sb);
    expect(texts(db.doc)).toEqual(["typed offline"]);
  });

  test("an edit the relay stored before the socket dropped, ack and all, isn't stored again on reconnect (T1734)", async () => {
    const w = await world();
    const [ana, bo] = await Promise.all([generateIdentity("ana"), generateIdentity("bo")]);
    const a = w.hubFor(ana);
    const b = w.hubFor(bo);
    const pa = w.plug(a);
    const sb = w.plug(b).s;
    const da = await a.open("T5");
    const db = await b.open("T5", da.th);
    await w.settle(pa.s, sb);
    newBlock(da.doc, "text", "ana", "said once");
    await w.settle(sb);
    w.relay.hang(pa.s);
    pa.unplug();
    const back = w.plug(a).s;
    await w.settle(back, sb);
    expect(texts(db.doc)).toEqual(["said once"]);
    expect(w.relay.rows.filter((r) => r.th === da.th)).toHaveLength(1);
  });

  test("a second socket doesn't send an edit again while the first still owes its ack (T1734)", async () => {
    const w = await world();
    const [ana, bo] = await Promise.all([generateIdentity("ana"), generateIdentity("bo")]);
    const a = w.hubFor(ana);
    const b = w.hubFor(bo);
    const first = w.plug(a);
    const sb = w.plug(b).s;
    const da = await a.open("T6");
    const db = await b.open("T6", da.th);
    await w.settle(first.s, sb);
    newBlock(da.doc, "text", "ana", "one copy");
    await w.settle(sb);
    const second = w.plug(a).s;
    await w.settle(first.s, second, sb);
    expect(texts(db.doc)).toEqual(["one copy"]);
    expect(w.relay.rows.filter((r) => r.th === da.th)).toHaveLength(1);
  });

  test("an edit that never reached the relay goes out once the new socket has caught up (T1734)", async () => {
    const w = await world();
    const [ana, bo] = await Promise.all([generateIdentity("ana"), generateIdentity("bo")]);
    const a = w.hubFor(ana);
    const b = w.hubFor(bo);
    const pa = w.plug(a);
    const sb = w.plug(b).s;
    const da = await a.open("T7");
    const db = await b.open("T7", da.th);
    await w.settle(pa.s, sb);
    w.relay.hang(pa.s);
    newBlock(da.doc, "text", "ana", "lost in the drop");
    await w.settle(sb);
    pa.unplug();
    const back = w.plug(a).s;
    await w.settle(back, sb);
    expect(texts(db.doc)).toEqual(["lost in the drop"]);
    expect(w.relay.rows.filter((r) => r.th === da.th)).toHaveLength(1);
  });

  test("with two sockets, when the one that subscribed drops, the doc still gets the others' edits (T1444)", async () => {
    const w = await world();
    const [ana, bo] = await Promise.all([generateIdentity("ana"), generateIdentity("bo")]);
    const a = w.hubFor(ana);
    const b = w.hubFor(bo);
    const first = w.plug(a);
    const sb = w.plug(b).s;
    const da = await a.open("T4");
    const db = await b.open("T4", da.th);
    await w.settle(first.s, sb);
    const second = w.plug(a).s;
    await w.settle(first.s, second, sb);
    w.relay.hang(first.s);
    first.unplug();
    newBlock(db.doc, "text", "bo", "after the drop");
    await w.settle(second, sb);
    expect(texts(da.doc)).toEqual(["after the drop"]);
    newBlock(da.doc, "text", "ana", "and back");
    await w.settle(second, sb);
    expect(texts(db.doc)).toEqual(["after the drop", "and back"]);
  });

  test("two who open the same thread at once end up in the winner's doc with both their words", async () => {
    const w = await world();
    const [ana, bo] = await Promise.all([generateIdentity("ana"), generateIdentity("bo")]);
    const a = w.hubFor(ana);
    const b = w.hubFor(bo);
    const sa = w.plug(a).s;
    const sb = w.plug(b).s;
    const da = await a.open("#general");
    const lost = await b.open("#general");
    expect(lost.th).not.toBe(da.th);
    newBlock(da.doc, "text", "ana", "ana's");
    newBlock(lost.doc, "text", "bo", "bo's");
    await w.settle(sa, sb);
    const won = await b.open("#general", da.th);
    await w.settle(sa, sb);
    expect(texts(won.doc).sort()).toEqual(["ana's", "bo's"]);
    expect(texts(da.doc).sort()).toEqual(["ana's", "bo's"]);
  });

  test("a local copy opens the doc before the socket, and keeps edits the relay never got", async () => {
    const w = await world();
    const ana = await generateIdentity("ana");
    const store = memoryStore();
    const first = w.hubFor(ana, store);
    const s1 = w.plug(first).s;
    const d1 = await first.open("T4");
    newBlock(d1.doc, "text", "ana", "kept");
    await w.settle(s1);
    w.relay.hang(s1);
    newBlock(d1.doc, "text", "ana", "never sent");
    await w.settle(s1);
    first.closeAll();
    await tick();
    const again = w.hubFor(ana, store);
    const d2 = await again.open("T4", d1.th);
    expect(texts(d2.doc)).toEqual(["kept", "never sent"]);
    const s2 = w.plug(again).s;
    await w.settle(s2);
    const bo = w.hubFor(await generateIdentity("bo"));
    const s3 = w.plug(bo).s;
    const d3 = await bo.open("T4", d1.th);
    await w.settle(s2, s3);
    expect(texts(d3.doc)).toEqual(["kept", "never sent"]);
  });

  test("the file store keeps a doc between runs, sealed to the seat, and ignores what it can't read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-docs-"));
    try {
      const roomId = newRoomId();
      const seat = { roomId, sk: (await generateIdentity("ana")).sk };
      const store = fileDocStore(dir, seat);
      const th = newDocId();
      expect(await store.load(th)).toBeNull();
      const words = new TextEncoder().encode("plans nobody else reads");
      await store.save(th, { head: 3, state: words, unsent: Uint8Array.of(9) });
      expect(await store.load(th)).toEqual({ head: 3, state: words, unsent: Uint8Array.of(9) });
      const onDisk = readFileSync(join(dir, `${th}.doc`), "utf8");
      expect(onDisk).not.toContain(b64url(words));
      expect(onDisk).not.toContain("head");
      expect(await fileDocStore(dir, { roomId, sk: (await generateIdentity("bo")).sk }).load(th)).toBeNull();
      expect(await fileDocStore(dir, { roomId: newRoomId(), sk: seat.sk }).load(th)).toBeNull();
      await Bun.write(join(dir, `${th}.doc`), "{torn");
      expect(await store.load(th)).toBeNull();
      await expect(store.load("../escape")).rejects.toThrow("not a doc id");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("doc.open in the channel's state", () => {
  test("the first doc.open of a thread wins; a later one for it changes nothing", async () => {
    const [jon, ana] = await Promise.all([generateIdentity("jon"), generateIdentity("ana")]);
    const ids: Record<string, Identity> = { jon, ana };
    const roster: Roster = [
      { name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" },
      { name: "ana", pk: ana.pk, owner: false, at: 1, active: true, kind: "agent" },
    ];
    let seq = 0;
    const ev = async (from: string, e: Event): Promise<Message> => {
      seq++;
      const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
      return { ...p, seq, rts: seq, sigOk: await verify(p) };
    };
    const first = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const second = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const s = fold([await ev("ana", { op: "doc.open", thread: "T7", th: first }), await ev("jon", { op: "doc.open", thread: "T7", th: second })], roster);
    expect(s.docs.get("T7")).toBe(first);
  });
});

describe("thread docs over a real relay", () => {
  test("two clients of a channel share a thread doc through the live socket, and doc.open lands in the log", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "kiwi-doc-live-"));
    const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
    const stop = new AbortController();
    try {
      const relay = server.url.origin;
      const owner = await generateIdentity("docs");
      const { access } = await Channel.create(relay, owner, { name: "docs", kind: "human" }, []);
      const a = new Channel(access, relay, owner);
      const b = new Channel(access, relay, owner);
      const ready = (ch: Channel) =>
        new Promise<void>((done) => {
          void ch.stream(0, () => {}, { signal: stop.signal, onReady: () => done() });
        });
      await Promise.all([ready(a), ready(b)]);
      const da = await a.threadDoc("T9");
      await da.whenSynced();
      const db = await b.threadDoc("T9", da.th);
      await db.whenSynced();
      newBlock(da.doc, "text", "docs", "over the wire");
      const deadline = Date.now() + 5_000;
      while (!texts(db.doc).length && Date.now() < deadline) await tick();
      expect(texts(db.doc)).toEqual(["over the wire"]);
      const { messages } = await a.history(0);
      expect(messages.some((m) => m.ev?.op === "doc.open" && m.ev.thread === "T9" && m.ev.th === da.th)).toBe(true);
    } finally {
      stop.abort();
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("docs of members-only rooms and DMs are sealed with the room's key (T601)", () => {
  const roomKeys = (gens: string[]): ThreadKeys => ({ sealed: true, current: async () => ({ key: gens[0]!, e: 1 }), opening: async () => gens });

  test("thread names are the same for the app and the CLI", () => {
    expect(docThread({ kind: "main" })).toBe("main");
    expect(docThread({ kind: "room", room: "general" })).toBe("main");
    expect(docThread({ kind: "task", task: 7 })).toBe("task:7");
    expect(docThread({ kind: "room", room: "r1" })).toBe("room:r1");
    expect(docThread({ kind: "dm", with: ["ana", "bo"] })).toBe("dm:ana~bo");
  });

  test("a doc's key follows its room: the room's own key when it has one, the channel key for a known room without one, and never for an unknown room (T693)", async () => {
    const members = [
      { name: "ana", pk: "pa" },
      { name: "bo", pk: "pb" },
    ];
    const known = new Map<string, { members?: typeof members; dm?: boolean }>([
      ["sealed", { members }],
      ["fresh", { members }],
      ["d1", { members, dm: true }],
    ]);
    const rooms: RoomsHere = { isPublic: (id) => id === "open", members: (id) => known.get(id), all: () => known };
    const held = new Map<string, string[]>([["sealed", ["k2", "k1"]]]);
    const here = { rooms, epoch: () => 3, roomKeys: (room: string) => held.get(room) ?? [], keyed: (room: string) => (held.get(room)?.length ?? 0) > 0 };
    const channel: ThreadKeys = { current: async () => ({ key: "channel", e: 3 }), opening: async () => ["channel"] };

    const keyed = docKeysFor("room:sealed", here, channel);
    expect(keyed.sealed).toBe(true);
    expect(await keyed.current()).toEqual({ key: "k2", e: 3 });
    expect(await keyed.opening(undefined)).toEqual(["k2", "k1"]);
    held.set("sealed", []);
    await expect(keyed.current()).rejects.toThrow("no key for room sealed");

    for (const thread of ["room:fresh", "dm:bo~ana"]) {
      const plain = docKeysFor(thread, here, channel);
      expect(plain.sealed).toBeUndefined();
      expect(await plain.current()).toEqual({ key: "channel", e: 3 });
      expect(await plain.opening(undefined)).toEqual(["channel"]);
    }
    const before = docKeysFor("room:fresh", here, channel);
    held.set("fresh", ["k9"]);
    await expect(before.current()).rejects.toThrow("has its own key now");
    expect(await docKeysFor("room:fresh", here, channel).current()).toEqual({ key: "k9", e: 3 });

    expect(docKeysFor("main", here, channel)).toBe(channel);
    expect(docKeysFor("room:open", here, channel)).toBe(channel);
    expect(() => docKeysFor("room:unheard", here, channel)).toThrow("doesn't know room");
    expect(() => docKeysFor("dm:ana~cy", here, channel)).toThrow("no direct-message room");
  });

  test("a thread is private only for a room with members; a room the app doesn't know is refused, never sealed for the channel", () => {
    const members = [
      { name: "ana", pk: "pa" },
      { name: "bo", pk: "pb" },
    ];
    const known = new Map<string, { members?: typeof members; dm?: boolean }>([
      ["secret", { members }],
      ["d1", { members, dm: true }],
    ]);
    const rooms: RoomsHere = { isPublic: (id) => id === "open", members: (id) => known.get(id), all: () => known };
    expect(privateRoomOf("main", rooms)).toBeNull();
    expect(privateRoomOf("task:3", rooms)).toBeNull();
    expect(privateRoomOf("room:open", rooms)).toBeNull();
    expect(privateRoomOf("room:secret", rooms)).toBe("secret");
    expect(privateRoomOf("dm:bo~ana", rooms)).toBe("d1");
    expect(() => privateRoomOf("room:unheard", rooms)).toThrow("doesn't know room");
    expect(() => privateRoomOf("dm:ana~cy", rooms)).toThrow("no direct-message room");
  });

  test("members read the room's doc and its cursors; a channel member outside the room gets neither", async () => {
    const w = await world();
    const k1 = newChannelKey();
    const [ana, bo, cy] = await Promise.all([generateIdentity("ana"), generateIdentity("bo"), generateIdentity("cy")]);
    const a = w.hubFor(ana, null, () => roomKeys([k1]));
    const b = w.hubFor(bo, null, () => roomKeys([k1]));
    const c = w.hubFor(cy);
    const [sa, sb, sc] = [w.plug(a).s, w.plug(b).s, w.plug(c).s];
    const da = await a.open("room:secret");
    const db = await b.open("room:secret", da.th);
    const dc = await c.open("room:secret", da.th);
    await w.settle(sa, sb, sc);
    newBlock(da.doc, "text", "ana", "members only");
    da.awareness.setLocalStateField("user", { name: "ana" });
    await w.settle(sa, sb, sc);
    expect(texts(db.doc)).toEqual(["members only"]);
    expect(texts(dc.doc)).toEqual([]);
    expect(db.awareness.getStates().get(da.doc.clientID)).toEqual({ user: { name: "ana" } });
    expect(dc.awareness.getStates().has(da.doc.clientID)).toBe(false);
  });

  test("a member who closes the room's doc takes its cursor with it, and its last cursor never goes out under the channel key (T1734)", async () => {
    const w = await world();
    const k1 = newChannelKey();
    const [ana, bo, cy] = await Promise.all([generateIdentity("ana"), generateIdentity("bo"), generateIdentity("cy")]);
    const a = w.hubFor(ana, null, () => roomKeys([k1]));
    const b = w.hubFor(bo, null, () => roomKeys([k1]));
    const c = w.hubFor(cy);
    const [sa, sb, sc] = [w.plug(a).s, w.plug(b).s, w.plug(c).s];
    const da = await a.open("room:secret");
    const db = await b.open("room:secret", da.th);
    await c.open("room:secret", da.th);
    da.awareness.setLocalStateField("user", { name: "ana" });
    await w.settle(sa, sb, sc);
    expect(db.awareness.getStates().has(da.doc.clientID)).toBe(true);
    da.awareness.setLocalStateField("selection", { block: "b1", text: "the secret line" });
    a.close("room:secret");
    await w.settle(sa, sb, sc);
    expect(db.awareness.getStates().has(da.doc.clientID)).toBe(false);
    const sent = await Promise.all(w.relay.ephs.map(async (raw) => JSON.stringify(await open(w.key, w.roomId, ...((f) => [f.iv, f.ct] as const)(JSON.parse(raw) as { iv: string; ct: string })))));
    expect(sent.some((p) => p.includes(da.th))).toBe(true);
    for (const p of sent) for (const [th, u] of (JSON.parse(p) as { docs: [string, string][] }).docs) if (th === da.th) expect(u.startsWith("~")).toBe(true);
    a.closeAll();
    b.closeAll();
    c.closeAll();
  });

  test("after the room's key changes, a member's client re-seals the doc as a snapshot that only the new key opens", async () => {
    const w = await world();
    const [k1, k2] = [newChannelKey(), newChannelKey()];
    const [ana, bo, dee] = await Promise.all([generateIdentity("ana"), generateIdentity("bo"), generateIdentity("dee")]);
    const a = w.hubFor(ana, null, () => roomKeys([k1]));
    const sa = w.plug(a).s;
    const da = await a.open("room:secret");
    await w.settle(sa);
    newBlock(da.doc, "text", "ana", "before the re-key");
    await w.settle(sa);
    const b = w.hubFor(bo, null, () => roomKeys([k2, k1]));
    const sb = w.plug(b).s;
    const db = await b.open("room:secret", da.th);
    await w.settle(sa, sb);
    for (let i = 0; i < 50 && !w.relay.snaps.length; i++) await w.settle(sa, sb);
    expect(texts(db.doc)).toEqual(["before the re-key"]);
    expect(w.relay.snaps).toEqual([da.th]);
    const d = w.hubFor(dee, null, () => roomKeys([k2]));
    const sd = w.plug(d).s;
    const dd = await d.open("room:secret", da.th);
    await w.settle(sd);
    expect(texts(dd.doc)).toEqual(["before the re-key"]);
  });
});

describe("a refused doc subscribe is tried again, so the doc syncs (T1427)", () => {
  test("the relay's err for a doc.sub carries no id: the hub routes it by thread, and the doc subscribes again after the wait", async () => {
    const me = await generateIdentity("me");
    const key = newChannelKey();
    const th = newDocId();
    const subs: number[] = [];
    const hub = new DocHub({
      roomId: newRoomId(),
      me,
      keysFor: () => ({ current: async () => ({ key }), opening: async () => [key] }),
      sealAware: async () => ({ iv: "", ct: "" }),
      announce: async () => {},
      retryMs: 30,
    });
    hub.attach((raw) => {
      const f = JSON.parse(raw) as DocOut;
      if (f.t !== "doc.sub") return;
      subs.push(performance.now());
      const answer = subs.length < 3 ? { t: "err", th, error: "too many doc subscriptions; slow down", tag: "TooMany" } : { t: "doc.ready", th, head: 0 };
      setTimeout(() => expect(hub.take(answer)).toBe(true), 1);
    });
    const td = await hub.open("main", th);
    const synced = await Promise.race([td.whenSynced().then(() => true), Bun.sleep(1_000).then(() => false)]);
    hub.closeAll();
    expect(synced).toBe(true);
    expect(subs).toHaveLength(3);
    expect(subs[1]! - subs[0]!).toBeGreaterThanOrEqual(30);
    expect(subs[2]! - subs[1]!).toBeGreaterThanOrEqual(60);
  });
});
