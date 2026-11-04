import { describe, expect, test } from "bun:test";
import { b64url, fromB64url, newChannelKey, newRoomId } from "@kiwi/core/crypto.ts";
import { DOC_LEVEL, raiseWriterFloor, writerFloor } from "@kiwi/core/doc/level.ts";
import { pipeDoc } from "@kiwi/core/doc/pipe.ts";
import { appendToBlock, blocksOf, newBlock, newDocId, threadOf, threadText } from "@kiwi/core/doc/blocks.ts";
import * as Y from "yjs";
import { ThreadDoc, type DocIn, type DocKeys, type DocOut } from "@kiwi/core/doc/thread-doc.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { DOC_COMPACT, MAX_CT_LENGTH } from "@kiwi/core/protocol.ts";

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

describe("a refused snapshot backs off, never loops (T1426)", () => {
  const scripted = async (answer: (f: DocOut, td: ThreadDoc) => DocIn | null) => {
    const th = newDocId();
    const key = newChannelKey();
    const me = await generateIdentity("a");
    const out: { f: DocOut; at: number }[] = [];
    let inbox: Promise<void> = Promise.resolve();
    const td: ThreadDoc = new ThreadDoc({
      roomId: newRoomId(),
      th,
      me,
      flushMs: 1,
      retryMs: 40,
      keys: { current: async () => ({ key, e: 1 }), opening: async () => [key] },
      links: {
        aware: () => {},
        send: (f) => {
          out.push({ f, at: performance.now() });
          const reply = f.t === "doc.sub" ? { t: "doc.ready" as const, th, head: 7 } : answer(f, td);
          if (reply) setTimeout(() => void (inbox = inbox.then(() => td.receive(reply))), 5);
        },
      },
    });
    td.start();
    await Bun.sleep(20);
    newBlock(td.doc, "text", me.pk, "one more line");
    return { td, out, snaps: () => out.filter((o) => o.f.t === "doc.snap"), updates: () => out.filter((o) => o.f.t === "doc") };
  };

  test("a snapshot the relay keeps refusing goes again after twice the wait each time, and the update it was for isn't sent again", async () => {
    const { td, snaps, updates } = await scripted((f) =>
      f.t === "doc.snap" ? { t: "err", id: f.id, error: "doc snapshot too large", tag: "TooLarge" } : f.t === "doc" ? { t: "err", id: f.id, error: DOC_COMPACT, tag: "TooLarge" } : null,
    );
    await Bun.sleep(700);
    td.destroy();
    const at = snaps().map((s) => s.at);
    const gaps = at.slice(1).map((t, i) => t - at[i]!);
    expect(at.length).toBeGreaterThanOrEqual(3);
    expect(at.length).toBeLessThanOrEqual(6);
    for (const [i, gap] of gaps.entries()) expect(gap).toBeGreaterThanOrEqual(40 * 2 ** i);
    expect(updates()).toHaveLength(1);
    expect(td.refused).toBe("doc snapshot too large");
  });

  test("once a snapshot lands, the update it carries is done, the refusal clears and nothing is left unsent; the hub routes the snapshot's answers to its doc", async () => {
    let refusals = 1;
    let owned = false;
    const { td, snaps } = await scripted((f, doc) => {
      if (f.t === "doc") return { t: "err", id: f.id, error: DOC_COMPACT, tag: "TooLarge" };
      if (f.t !== "doc.snap") return null;
      owned = doc.owns(f.id);
      return refusals-- > 0 ? { t: "err", id: f.id, error: "not ready", tag: "Conflict" } : { t: "ack", id: f.id, seq: 7 };
    });
    await Bun.sleep(200);
    expect(snaps()).toHaveLength(2);
    expect(owned).toBe(true);
    expect(td.refused).toBeNull();
    expect(td.save().unsent).toBeNull();
    td.destroy();
  });
});

describe("a doc line's text is what was typed (T2141)", () => {
  test("angle brackets in a line stay, bold or not", () => {
    const doc = new Y.Doc();
    const made = newBlock(doc, "text", "ana", "use <div> and a<b>c");
    const block = threadOf(doc)
      .toArray()
      .find((x): x is Y.XmlElement => x instanceof Y.XmlElement && x.getAttribute("id") === made.id)!;
    const words = (block.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    expect(blocksOf(doc).map((b) => b.text)).toEqual(["use <div> and a<b>c"]);
    words.format(0, 3, { strong: true });
    expect(blocksOf(doc).map((b) => b.text)).toEqual(["use <div> and a<b>c"]);
  });
});

function uiOn(host: Peer, level: number) {
  const doc = new Y.Doc();
  let refused = false;
  const pipe = pipeDoc(host.td.doc, host.td.awareness, (out) => out._tag === "Update" && Y.applyUpdate(doc, fromB64url(out.u), "host"), Promise.resolve(), {
    level,
    refused: () => void (refused = true),
  });
  doc.on("update", (u: Uint8Array, origin: unknown) => origin !== "host" && pipe.update(b64url(u)));
  return { doc, refused: () => refused };
}

describe("an upgraded host takes no writes from a UI older than the doc's writer floor (T2558)", () => {
  test("once a new UI raised the floor, an old UI's line and its offline full-state resend never reach the doc; the new UI's do", async () => {
    const { peers, ids } = await setup(2);
    const [a, b] = peers as [Peer, Peer];
    a.td.start();
    b.td.start();
    await settle(a, b);
    const fresh = uiOn(a, DOC_LEVEL);
    const old = uiOn(a, 0);
    await Promise.resolve();
    raiseWriterFloor(fresh.doc, DOC_LEVEL);
    newBlock(fresh.doc, "text", ids[0]!.pk, "from the new look");
    await settle(a, b);
    expect(writerFloor(b.td.doc)).toBe(DOC_LEVEL);
    newBlock(old.doc, "text", ids[0]!.pk, "from an old window");
    const offline = new Y.Doc();
    newBlock(offline, "text", ids[0]!.pk, "typed while offline");
    const again = uiOn(a, 0);
    Y.applyUpdate(again.doc, Y.encodeStateAsUpdate(offline));
    await settle(a, b);
    expect(old.refused()).toBe(true);
    expect(again.refused()).toBe(true);
    expect(fresh.refused()).toBe(false);
    expect(texts(a)).toEqual(["from the new look"]);
    expect(texts(b)).toEqual(["from the new look"]);
  });

  test("an old UI writes as before while no new UI has raised the floor", async () => {
    const { peers, ids } = await setup(1);
    const [a] = peers as [Peer];
    a.td.start();
    await settle(a);
    const old = uiOn(a, 0);
    await Promise.resolve();
    newBlock(old.doc, "text", ids[0]!.pk, "hello");
    await settle(a);
    expect(old.refused()).toBe(false);
    expect(texts(a)).toEqual(["hello"]);
  });

  test("agents still write after the floor rises: the gate is only on UI pipes", async () => {
    const { peers, ids } = await setup(2);
    const [a, b] = peers as [Peer, Peer];
    a.td.start();
    b.td.start();
    await settle(a, b);
    raiseWriterFloor(uiOn(a, DOC_LEVEL).doc, DOC_LEVEL);
    await settle(a, b);
    newBlock(b.td.doc, "text", ids[1]!.pk, "agent on 11.7");
    newBlock(a.td.doc, "text", ids[0]!.pk, "agent here");
    await settle(a, b);
    expect(texts(a).sort()).toEqual(["agent here", "agent on 11.7"]);
    expect(texts(b).sort()).toEqual(texts(a).sort());
  });

  test("the limit: a host that isn't upgraded still sends its old UI's deletion, and upgraded hosts apply it", async () => {
    const { peers, ids } = await setup(2);
    const [a, b] = peers as [Peer, Peer];
    a.td.start();
    b.td.start();
    await settle(a, b);
    const fresh = uiOn(a, DOC_LEVEL);
    await Promise.resolve();
    raiseWriterFloor(fresh.doc, DOC_LEVEL);
    newBlock(fresh.doc, "text", ids[0]!.pk, "jow's line");
    await settle(a, b);
    const line = threadOf(b.td.doc);
    line.delete(0, line.length);
    await settle(a, b);
    expect(texts(a)).toEqual([]);
  });

  test("a snapshot taken after a refusal never carries the refused edit to a late joiner", async () => {
    const { peers, ids, relay, make } = await setup(2);
    const [a] = peers as [Peer, Peer];
    relay.compactAfter = 2;
    a.td.start();
    await settle(a);
    const fresh = uiOn(a, DOC_LEVEL);
    const old = uiOn(a, 0);
    await Promise.resolve();
    raiseWriterFloor(fresh.doc, DOC_LEVEL);
    const blk = newBlock(fresh.doc, "text", ids[0]!.pk, "");
    for (const ch of "kept") {
      appendToBlock(fresh.doc, blk.id, ch);
      await settle(a);
    }
    newBlock(old.doc, "text", ids[0]!.pk, "refused");
    await settle(a);
    expect(relay.rows[0]!.snap).toBe(true);
    const late = make(ids[1]!);
    late.td.start();
    await settle(late);
    expect(texts(late)).toEqual(["kept"]);
  });
});
