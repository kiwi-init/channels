import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { b64url, fromB64url, openBytes, sealBytes } from "../crypto.ts";
import { sign, verify, type Identity } from "../identity.ts";
import { DOC_COMPACT, DOC_THREAD_RE } from "../protocol.ts";

const FLUSH_MS = 40;

export type DocOut =
  | { t: "doc"; id: string; th: string; iv: string; ct: string; e?: number }
  | { t: "doc.snap"; id: string; th: string; upto: number; iv: string; ct: string; e?: number }
  | { t: "doc.sub"; th: string; since: number }
  | { t: "doc.unsub"; th: string };

export type DocIn =
  | { t: "doc"; th: string; dseq: number; ts: number; iv: string; ct: string; e?: number; snap?: true }
  | { t: "doc.ready"; th: string; head: number }
  | { t: "ack"; id: string; seq: number; compact?: true }
  | { t: "err"; id?: string; error: string; tag?: string };

export interface DocSaved {
  head: number;
  state: Uint8Array;
  unsent: Uint8Array | null;
}

const RETRY_MS = 2_000;

export interface DocKeys {
  current: () => Promise<{ key: string; e?: number }>;
  opening: (e: number | undefined) => Promise<readonly string[]>;
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
  saved?: DocSaved | null;
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
  private sealedWith: string | null = null;
  private stale = false;

  constructor(o: DocOptions, doc: Y.Doc = new Y.Doc()) {
    if (!DOC_THREAD_RE.test(o.th)) throw new Error(`not a doc id: ${o.th}`);
    this.o = o;
    this.th = o.th;
    this.doc = doc;
    this.awareness = new awarenessProtocol.Awareness(doc);
    if (o.saved) {
      Y.applyUpdate(doc, o.saved.state, REMOTE);
      this.head = o.saved.head;
      if (o.saved.unsent) this.pending.push(o.saved.unsent);
    }
    doc.on("update", this.onUpdate);
    this.awareness.on("update", this.onAwareness);
    if (this.pending.length) void this.flush();
  }

  owns(id: string): boolean {
    return this.inFlight.has(id);
  }

  save(): DocSaved {
    const unsent = [...this.pending, ...this.inFlight.values()];
    return { head: this.head, state: Y.encodeStateAsUpdate(this.doc), unsent: unsent.length ? Y.mergeUpdates(unsent) : null };
  }

  get synced(): boolean {
    return this.ready;
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
    if (this.sealedWith && this.sealedWith !== key) this.stale = true;
    this.sealedWith = key;
    const signed = await sign(this.o.me, { th: this.th, u: b64url(update) });
    const box = await sealBytes(key, enc.encode(JSON.stringify(signed)), ad(this.o.roomId, this.th));
    return e === undefined ? box : { ...box, e };
  }

  private async open(iv: string, ct: string, e: number | undefined): Promise<Uint8Array | null> {
    const keys = await this.o.keys.opening(e);
    let plain: Uint8Array<ArrayBuffer> | null = null;
    for (const [i, key] of keys.entries()) {
      plain = await openBytes(key, iv, ct, ad(this.o.roomId, this.th));
      if (!plain) continue;
      if (i > 0) this.stale = true;
      break;
    }
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
    if (this.stale && this.ready) await this.compact();
  }

  private async compact(): Promise<void> {
    if (this.closed || !this.ready) return;
    const upto = Math.max(this.head, this.top);
    if (upto === 0) return;
    const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const sealed = await this.seal(Y.encodeStateAsUpdate(this.doc));
    this.stale = false;
    this.o.links.send({ t: "doc.snap", id, th: this.th, upto, ...sealed });
  }

  private async take(f: DocIn): Promise<void> {
    if (this.closed) return;
    if (f.t === "err") {
      if (!f.id || !this.inFlight.has(f.id)) return;
      const update = this.inFlight.get(f.id)!;
      const id = f.id;
      if (f.error === DOC_COMPACT) {
        await this.compact();
        await this.post(update, id);
        return;
      }
      setTimeout(() => {
        if (this.inFlight.has(id)) this.chain = this.chain.then(() => this.post(update, id));
      }, RETRY_MS);
      return;
    }
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
      if (this.stale) await this.compact();
      return;
    }
    if (!f.snap && f.dseq <= this.head) return;
    const update = await this.open(f.iv, f.ct, f.e);
    this.head = Math.max(this.head, f.dseq);
    if (update) Y.applyUpdate(this.doc, update, REMOTE);
  }
}
