import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { b64url, fromB64url, openBytes, sealBytes } from "../crypto.ts";
import { sign, verify, type Identity } from "../identity.ts";

const DOC_ID = /^[A-Za-z0-9_-]{22}$/;
const FLUSH_MS = 40;

export type DocOut =
  | { t: "doc"; id: string; th: string; iv: string; ct: string; e?: number }
  | { t: "doc.snap"; id: string; th: string; upto: number; iv: string; ct: string; e?: number }
  | { t: "doc.sub"; th: string; since: number }
  | { t: "doc.unsub"; th: string };

export type DocIn =
  | { t: "doc"; th: string; dseq: number; ts: number; iv: string; ct: string; e?: number; snap?: true }
  | { t: "doc.ready"; th: string; head: number }
  | { t: "ack"; id: string; seq: number; compact?: true };

interface DocKeys {
  current: () => Promise<{ key: string; e?: number }>;
  at: (e: number | undefined) => Promise<string | null>;
}

interface DocLinks {
  send: (frame: DocOut) => void;
  aware: (th: string, update: Uint8Array) => void;
}

export interface DocOptions {
  roomId: string;
  th: string;
  me: Identity;
  keys: DocKeys;
  links: DocLinks;
  trusts?: (pk: string) => boolean;
  flushMs?: number;
}

interface Signed {
  th: string;
  u: string;
  pk: string;
  sig: string;
}

const REMOTE = Symbol("remote");
const enc = new TextEncoder();
const dec = new TextDecoder();
const ad = (roomId: string, th: string) => `kiwi-doc\n${roomId}\n${th}`;

const isSigned = (x: unknown): x is Signed => {
  const s = x as Partial<Signed> | null;
  return !!s && typeof s.th === "string" && typeof s.u === "string" && typeof s.pk === "string" && typeof s.sig === "string";
};

export class ThreadDoc {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly th: string;
  private readonly o: DocOptions;
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = new Map<string, Uint8Array>();
  private head = 0;
  private top = 0;
  private ready = false;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private readonly waiters: (() => void)[] = [];

  constructor(o: DocOptions, doc: Y.Doc = new Y.Doc()) {
    if (!DOC_ID.test(o.th)) throw new Error(`not a doc id: ${o.th}`);
    this.o = o;
    this.th = o.th;
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    doc.on("update", this.onUpdate);
    this.awareness.on("update", this.onAwareness);
  }

  get synced(): boolean {
    return this.ready;
  }

  get seen(): number {
    return this.head;
  }

  whenSynced(): Promise<void> {
    return this.ready ? Promise.resolve() : new Promise((done) => this.waiters.push(done));
  }

  start(since = this.head): void {
    this.o.links.send({ t: "doc.sub", th: this.th, since });
  }

  reconnect(): void {
    this.ready = false;
    this.start(this.head);
    for (const [id, update] of this.inFlight) this.chain = this.chain.then(() => this.post(update, id));
  }

  receive(frame: DocIn): Promise<void> {
    this.chain = this.chain.then(() => this.take(frame));
    return this.chain;
  }

  applyAwareness(update: Uint8Array): void {
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, REMOTE);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.length) return this.chain;
    const update = this.pending.length === 1 ? this.pending[0]! : Y.mergeUpdates(this.pending);
    this.pending = [];
    const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
    this.inFlight.set(id, update);
    this.chain = this.chain.then(() => this.post(update, id));
    return this.chain;
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.awareness.setLocalState(null);
    this.doc.off("update", this.onUpdate);
    this.awareness.off("update", this.onAwareness);
    this.awareness.destroy();
    this.o.links.send({ t: "doc.unsub", th: this.th });
  }

  private readonly onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE || this.closed) return;
    this.pending.push(update);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.o.flushMs ?? FLUSH_MS);
  };

  private readonly onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void => {
    if (origin === REMOTE || this.closed) return;
    const ids = [...added, ...updated, ...removed].filter((id) => id === this.doc.clientID);
    if (ids.length) this.o.links.aware(this.th, awarenessProtocol.encodeAwarenessUpdate(this.awareness, ids));
  };

  private async seal(update: Uint8Array): Promise<{ iv: string; ct: string; e?: number }> {
    const { key, e } = await this.o.keys.current();
    const signed = await sign(this.o.me, { th: this.th, u: b64url(update) });
    const box = await sealBytes(key, enc.encode(JSON.stringify(signed)), ad(this.o.roomId, this.th));
    return e === undefined ? box : { ...box, e };
  }

  private async open(iv: string, ct: string, e: number | undefined): Promise<Uint8Array | null> {
    const key = await this.o.keys.at(e);
    if (!key) return null;
    const plain = await openBytes(key, iv, ct, ad(this.o.roomId, this.th));
    if (!plain) return null;
    let body: unknown;
    try {
      body = JSON.parse(dec.decode(plain));
    } catch {
      // A member sealed something that isn't a doc update: drop it like a bad signature.
      return null;
    }
    if (!isSigned(body) || body.th !== this.th) return null;
    if (this.o.trusts && !this.o.trusts(body.pk)) return null;
    if (!(await verify(body))) return null;
    return fromB64url(body.u);
  }

  private async post(update: Uint8Array, id: string): Promise<void> {
    if (this.closed) return;
    this.o.links.send({ t: "doc", id, th: this.th, ...(await this.seal(update)) });
  }

  private async compact(): Promise<void> {
    if (this.closed || !this.ready || this.pending.length || this.inFlight.size) return;
    const upto = Math.max(this.head, this.top);
    const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
    this.o.links.send({ t: "doc.snap", id, th: this.th, upto, ...(await this.seal(Y.encodeStateAsUpdate(this.doc))) });
  }

  private async take(f: DocIn): Promise<void> {
    if (this.closed) return;
    if (f.t === "ack") {
      if (!this.inFlight.delete(f.id)) return;
      this.top = Math.max(this.top, f.seq);
      if (f.compact) await this.compact();
      return;
    }
    if (f.th !== this.th) return;
    if (f.t === "doc.ready") {
      this.head = Math.max(this.head, f.head);
      this.ready = true;
      for (const done of this.waiters.splice(0)) done();
      return;
    }
    if (!f.snap && f.dseq <= this.head) return;
    const update = await this.open(f.iv, f.ct, f.e);
    this.head = Math.max(this.head, f.dseq);
    if (update) Y.applyUpdate(this.doc, update, REMOTE);
  }
}
