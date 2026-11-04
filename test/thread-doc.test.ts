import { describe, expect, test } from "bun:test";
import { newChannelKey, newRoomId } from "@kiwi/core/crypto.ts";
import { appendToBlock, blocksOf, newBlock, newDocId, threadOf, threadText } from "@kiwi/core/doc/blocks.ts";
import { ThreadDoc, type DocIn, type DocKeys, type DocOut } from "@kiwi/core/doc/thread-doc.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { MAX_CT_LENGTH } from "@kiwi/core/protocol.ts";

interface Row {
  dseq: number;
  ts: number;
  iv: string;
  ct: string;
  e?: number;
  snap?: true;
}

class FakeRelay {
  rows: Row[] = [];
  head = 0;
  compactAfter = Infinity;
  sinceSnap = 0;
  sent: DocOut[] = [];
  private subs = new Map<Peer, string>();

  link(peer: Peer): (f: DocOut) => void {
    return (f) => {
      this.sent.push(f);
      if (f.t === "doc.sub") {
        this.subs.set(peer, f.th);
        const snap = this.rows.find((r) => r.snap);
        const tail = this.rows.filter((r) => !r.snap && r.dseq > Math.max(f.since, snap?.dseq ?? 0));
        for (const r of [...(snap && snap.dseq > f.since ? [snap] : []), ...tail]) peer.deliver({ t: "doc", th: f.th, ...r });
        peer.deliver({ t: "doc.ready", th: f.th, head: this.head });
        return;
      }
      if (f.t === "doc.unsub") {
        this.subs.delete(peer);
        return;
      }
      if (f.t === "doc.snap") {
        if (f.upto > this.head) return;
        const snap: Row = { dseq: f.upto, ts: Date.now(), iv: f.iv, ct: f.ct, ...(f.e === undefined ? {} : { e: f.e }), snap: true };
        this.rows = [snap, ...this.rows.filter((r) => !r.snap && r.dseq > f.upto)];
        this.sinceSnap = this.rows.length - 1;
        peer.deliver({ t: "ack", id: f.id, seq: f.upto });
        for (const [other, th] of this.subs) if (other !== peer && th === f.th) other.deliver({ t: "doc", th, ...snap });
        return;
      }
      if (f.ct.length > MAX_CT_LENGTH) return peer.deliver({ t: "err", id: f.id, error: "doc update too large", tag: "TooLarge" });
      const row: Row = { dseq: ++this.head, ts: Date.now(), iv: f.iv, ct: f.ct, ...(f.e === undefined ? {} : { e: f.e }) };
      this.rows.push(row);
      this.sinceSnap++;
      peer.deliver({ t: "ack", id: f.id, seq: row.dseq, ...(this.sinceSnap >= this.compactAfter ? { compact: true as const } : {}) });
      for (const [other, th] of this.subs) if (other !== peer && th === f.th) other.deliver({ t: "doc", th, ...row });
    };
  }
}

class Peer {
  td!: ThreadDoc;
  inbox: Promise<void> = Promise.resolve();
  aware: Uint8Array[] = [];
  deliver(f: DocIn): void {
    this.inbox = this.inbox.then(() => this.td.receive(f));
  }
}

async function setup(n: number, opts: { trusts?: (pk: string) => boolean } = {}) {
  const roomId = newRoomId();
  const key = newChannelKey();
  const th = newDocId();
  const relay = new FakeRelay();
  const ids = await Promise.all(Array.from({ length: n }, (_, i) => generateIdentity(`p${i}`)));
  const make = (me: Identity, k = key, keys?: DocKeys) => {
    const peer = new Peer();
    peer.td = new ThreadDoc({
      roomId,
      th,
      me,
      keys: keys ?? { current: async () => ({ key: k, e: 1 }), opening: async (e) => (e === 1 ? [k] : []) },
      links: { send: relay.link(peer), aware: (_th, u) => peer.aware.push(u) },
      flushMs: 1,
      retryMs: 5,
      ...opts,
    });
    return peer;
  };
  return { relay, ids, make, key, peers: ids.map((id) => make(id)), th };
}

async function settle(...peers: Peer[]) {
  for (let i = 0; i < 4; i++) {
    await Promise.all(peers.map((p) => p.td.flush()));
    await Promise.all(peers.map((p) => p.inbox));
  }
}

const texts = (p: Peer) => blocksOf(p.td.doc).map((b) => b.text);

describe("a thread doc syncs sealed Yjs updates through the relay", () => {
  test("two people typing at once both keep every keystroke", async () => {
    const { peers, ids } = await setup(2);
    const [a, b] = peers as [Peer, Peer];
    a.td.start();
    b.td.start();
    await settle(a, b);
    const ba = newBlock(a.td.doc, "text", ids[0]!.pk, "hello");
    await settle(a, b);
    for (const ch of "abc") appendToBlock(a.td.doc, ba.id, ch);
    for (const ch of "xyz") appendToBlock(b.td.doc, ba.id, ch);
    newBlock(b.td.doc, "text", ids[1]!.pk, "second");
    await settle(a, b);
    expect(texts(a)).toEqual(texts(b));
    expect(texts(a)[0]).toContain("abc");
    expect(texts(a)[0]).toContain("xyz");
    expect(texts(a)[1]).toBe("second");
  });

  test("the relay only ever sees ciphertext", async () => {
    const { peers, ids, relay } = await setup(1);
    const [a] = peers as [Peer];
    a.td.start();
    await settle(a);
    newBlock(a.td.doc, "text", ids[0]!.pk, "a secret plan");
    await settle(a);
    expect(JSON.stringify(relay.sent)).not.toContain("secret");
    expect(relay.rows.length).toBe(1);
    expect(relay.rows[0]!.e).toBe(1);
  });

  test("a late joiner gets the whole doc, and after a snapshot only the snapshot and what follows", async () => {
    const { peers, ids, relay, make } = await setup(2);
    const [a, b] = peers as [Peer, Peer];
    relay.compactAfter = 3;
    a.td.start();
    await settle(a);
    const blk = newBlock(a.td.doc, "text", ids[0]!.pk, "");
    for (const ch of "one two three four") {
      appendToBlock(a.td.doc, blk.id, ch);
      await settle(a);
    }
    expect(relay.rows[0]!.snap).toBe(true);
    expect(relay.rows.length).toBeLessThan(4);
    b.td.start();
    await settle(a, b);
    expect(b.td.synced).toBe(true);
    expect(texts(b)).toEqual(["one two three four"]);
    const c = make(ids[1]!);
    c.td.start();
    await settle(c);
    expect(texts(c)).toEqual(["one two three four"]);
  });

  test("an update from a key outside the channel, or someone it doesn't trust, is dropped", async () => {
    const outsider = await generateIdentity("x");
    const { make, ids } = await setup(1, { trusts: (pk) => pk !== outsider.pk });
    const a = make(ids[0]!);
    const bad = make(outsider);
    a.td.start();
    bad.td.start();
    await settle(a, bad);
    newBlock(bad.td.doc, "text", outsider.pk, "spoofed");
    await settle(a, bad);
    expect(texts(a)).toEqual([]);
  });

  test("updates sealed with another key never apply", async () => {
    const { make, ids } = await setup(1);
    const a = make(ids[0]!);
    const wrong = make(ids[0]!, newChannelKey());
    a.td.start();
    wrong.td.start();
    await settle(a, wrong);
    newBlock(wrong.td.doc, "text", ids[0]!.pk, "wrong key");
    await settle(a, wrong);
    expect(texts(a)).toEqual([]);
  });

  test("cursors go out as awareness updates and come back in", async () => {
    const { peers } = await setup(2);
    const [a, b] = peers as [Peer, Peer];
    a.td.awareness.setLocalStateField("user", { name: "a" });
    expect(a.aware.length).toBe(1);
    b.td.applyAwareness(a.aware[0]!);
    expect(b.td.awareness.getStates().get(a.td.doc.clientID)).toEqual({ user: { name: "a" } });
    b.td.destroy();
    a.td.destroy();
  });

  test("the thread reads as plain text for agents", async () => {
    const { peers } = await setup(1);
    const doc = peers[0]!.td.doc;
    newBlock(doc, "text", "pkperson", "Can you fix it?\nIt breaks on start.");
    const reply = newBlock(doc, "agent", "pkagent", "On it");
    appendToBlock(doc, reply.id, ": found it");
    expect(threadOf(doc).length).toBe(2);
    expect(threadText(doc, (pk) => pk.slice(2))).toBe("person: Can you fix it?\nIt breaks on start.\n\nagent (agent): On it: found it");
  });

  test("an update too big for the relay goes out in a snapshot, and that person's next edits reach everyone", async () => {
    const { peers, ids, relay } = await setup(2);
    const [a, b] = peers as [Peer, Peer];
    a.td.start();
    b.td.start();
    await settle(a, b);
    newBlock(a.td.doc, "text", ids[0]!.pk, "small first");
    await settle(a, b);
    const pasted = "x".repeat(400_000);
    newBlock(a.td.doc, "text", ids[0]!.pk, pasted);
    await settle(a, b);
    newBlock(a.td.doc, "text", ids[0]!.pk, "a short reply");
    await settle(a, b);
    expect(texts(b)).toEqual(["small first", pasted, "a short reply"]);
    expect(relay.sent.filter((f) => f.t === "doc" && f.ct.length > MAX_CT_LENGTH)).toHaveLength(0);
    expect(relay.rows[0]!.snap).toBe(true);
  });
});

describe("a thread doc keeps going through faults (T1355)", () => {
  test("a seal that throws once doesn't stop the doc: that edit is sent again and the next ones follow", async () => {
    const { make, ids, key } = await setup(2);
    let fail = true;
    const a = make(ids[0]!, key, {
      current: async () => {
        if (!fail) return { key, e: 1 };
        fail = false;
        throw new Error("no channel key for this epoch yet");
      },
      opening: async (e) => (e === 1 ? [key] : []),
    });
    const b = make(ids[1]!);
    a.td.start();
    b.td.start();
    await settle(a, b);
    newBlock(a.td.doc, "text", ids[0]!.pk, "first");
    await settle(a, b);
    newBlock(a.td.doc, "text", ids[0]!.pk, "second");
    await settle(a, b);
    await Bun.sleep(20);
    await settle(a, b);
    expect(texts(b)).toEqual(["first", "second"]);
  });

  test("an update sealed under a key it doesn't have yet isn't skipped, and its snapshot never covers it", async () => {
    const { make, ids, key: k1, relay } = await setup(3);
    const k2 = newChannelKey();
    const both = async (e: number | undefined) => (e === 1 ? [k1] : e === 2 ? [k2] : []);
    let bHasK2 = false;
    const a = make(ids[0]!, k1, { current: async () => ({ key: k2, e: 2 }), opening: both });
    const b = make(ids[1]!, k1, {
      current: async () => (bHasK2 ? { key: k2, e: 2 } : { key: k1, e: 1 }),
      opening: async (e) => (e === 1 ? [k1] : e === 2 && bHasK2 ? [k2] : []),
    });
    b.td.start();
    await settle(b);
    newBlock(b.td.doc, "text", ids[1]!.pk, "b before the rotation");
    await settle(b);
    a.td.start();
    await settle(a, b);
    newBlock(a.td.doc, "text", ids[0]!.pk, "a after the rotation");
    await settle(a, b);
    expect(b.td.save().head).toBeLessThan(relay.head);
    bHasK2 = true;
    newBlock(b.td.doc, "text", ids[1]!.pk, "b after the rotation");
    await settle(a, b);
    newBlock(a.td.doc, "text", ids[0]!.pk, "a again");
    await settle(a, b);
    const c = make(ids[2]!, k1, { current: async () => ({ key: k2, e: 2 }), opening: both });
    c.td.start();
    await settle(c);
    expect(relay.rows.some((r) => r.snap)).toBe(true);
    for (const p of [b, c]) expect(texts(p).sort()).toEqual(["a after the rotation", "a again", "b after the rotation", "b before the rotation"]);
  });
});
