import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { b64url, newChannelKey, newRoomId, open, seal } from "@kiwi/core/crypto.ts";
import { appendToBlock, blocksOf, newBlock, newDocId } from "@kiwi/core/doc/blocks.ts";
import { DocHub, type DocStore } from "@kiwi/core/doc/hub.ts";
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
    if (f.t === "doc.snap") return;
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
  const hubFor = (me: Identity, store: DocStore | null = null) =>
    new DocHub({
      roomId,
      me,
      store,
      keys: { current: async () => ({ key, e: 1 }), at: async (e) => (e === 1 ? key : null) },
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

  test("the file store keeps a doc between runs and ignores what it can't read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-docs-"));
    try {
      const store = fileDocStore(dir);
      const th = newDocId();
      expect(await store.load(th)).toBeNull();
      await store.save(th, { head: 3, state: Uint8Array.of(1, 2, 3), unsent: null });
      expect(await store.load(th)).toEqual({ head: 3, state: Uint8Array.of(1, 2, 3), unsent: null });
      await Bun.write(join(dir, `${th}.json`), "{torn");
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
