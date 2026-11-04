import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { b64url, fromB64url, openBytes, sealBytes } from "../crypto.ts";
import { sign, verify, type Identity } from "../identity.ts";
import { DOC_COMPACT, DOC_THREAD_RE, MAX_CT_LENGTH } from "../protocol.ts";

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
  | { t: "err"; id?: string; th?: string; error: string; tag?: string; retryAfter?: number };

export interface DocSaved {
  head: number;
  state: Uint8Array;
  unsent: Uint8Array | null;
}

const RETRY_MS = 2_000;
const MAX_BACKOFF_STEPS = 5;

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
  retryMs?: number;
  saved?: DocSaved | null;
}

interface Signed {
  th: string;
  u: string;
  pk: string;
  sig: string;
}

const REMOTE = Symbol("remote");
const NO_KEY = Symbol("no key");
const enc = new TextEncoder();
const dec = new TextDecoder();
const ad = (roomId: string, th: string) => `kiwi-doc\n${roomId}\n${th}`;
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

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
  private readonly seen = new Set<number>();
  private refetching = false;
  private known = 0;
  private refetchedAt = -1;
  private refetchFails = 0;
  private refetch: ReturnType<typeof setTimeout> | null = null;
  private ready = false;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private readonly waiters: (() => void)[] = [];
  private sealedWith: string | null = null;
  private stale = false;
  private hole: { dseq: number; e: number | undefined } | null = null;
  private skipped: number | null = null;
  private readonly big = new Set<string>();
  private snapping: { id: string; covers: string[] } | null = null;
  private snapFails = 0;
  private subFails = 0;
  private resub: ReturnType<typeof setTimeout> | null = null;
  private refusedWith: string | null = null;
  private resend = false;

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
    return this.inFlight.has(id) || this.snapping?.id === id;
  }

  get refused(): string | null {
    return this.refusedWith;
  }

  save(): DocSaved {
    const unsent = [...this.pending, ...this.inFlight.values()];
    const head = Math.min(this.covered(), this.hole ? this.hole.dseq - 1 : this.head);
    return { head, state: Y.encodeStateAsUpdate(this.doc), unsent: unsent.length ? Y.mergeUpdates(unsent) : null };
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
    this.refetching = false;
    this.resend = this.inFlight.size > 0;
    this.start(this.head);
  }

  receive(frame: DocIn): Promise<void> {
    return this.queue(() => this.take(frame));
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
    return this.queue(() => this.post(update, id));
  }

  destroy(): void {
    if (this.closed) return;
    this.awareness.setLocalState(null);
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.resub) clearTimeout(this.resub);
    if (this.refetch) clearTimeout(this.refetch);
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

  private queue(step: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(step).catch(() => {
      // A step that threw (a key not there yet, an update Yjs can't read) is dropped so the steps after it still run: a post retries on its own, a gap is fetched again.
    });
    return this.chain;
  }

  private retry(update: Uint8Array, id: string): void {
    setTimeout(() => {
      if (this.inFlight.has(id) && !this.closed) void this.queue(() => this.post(update, id));
    }, this.o.retryMs ?? RETRY_MS);
  }

  private async refill(): Promise<void> {
    const hole = this.hole;
    if (!hole || this.closed || !(await this.o.keys.opening(hole.e)).length) return;
    this.hole = null;
    this.head = Math.min(this.head, hole.dseq - 1);
    this.seen.clear();
    this.ready = false;
    this.start(this.head);
  }

  private async open(iv: string, ct: string, e: number | undefined): Promise<Uint8Array | null | typeof NO_KEY> {
    const keys = await this.o.keys.opening(e);
    if (!keys.length) return NO_KEY;
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
    let sealed: Awaited<ReturnType<ThreadDoc["seal"]>>;
    try {
      sealed = await this.seal(update);
    } catch {
      // No key to seal with yet (a rotation still on its way): keep the update and send it again shortly.
      return this.retry(update, id);
    }
    if (sealed.ct.length > MAX_CT_LENGTH) {
      this.big.add(id);
      return this.compact();
    }
    this.o.links.send({ t: "doc", id, th: this.th, ...sealed });
    await this.refill();
    if (this.stale && this.ready) await this.compact();
  }

  private async compact(): Promise<void> {
    if (this.closed || !this.ready || this.hole || this.snapping) return;
    const upto = Math.min(this.head, this.covered());
    if (upto <= 0) return;
    const id = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const sealed = await this.seal(Y.encodeStateAsUpdate(this.doc));
    this.stale = false;
    this.snapping = { id, covers: [...this.big] };
    this.o.links.send({ t: "doc.snap", id, th: this.th, upto, ...sealed });
  }

  private covered(): number {
    return this.skipped === null ? Infinity : this.skipped - 1;
  }

  private landed(id: string, seq: number): void {
    this.inFlight.delete(id);
    this.refusedWith = null;
    this.saw(seq);
  }

  private saw(dseq: number, head = 0): void {
    if (dseq > this.head) this.seen.add(dseq);
    this.head = Math.max(this.head, head);
    this.known = Math.max(this.known, dseq, this.head);
    for (const d of this.seen) if (d <= this.head) this.seen.delete(d);
    while (this.seen.delete(this.head + 1)) this.head++;
    if (this.head >= this.known || !this.ready || this.refetching || this.closed) return;
    this.refetching = true;
    const stuck = this.head === this.refetchedAt;
    this.refetchFails = stuck ? this.refetchFails + 1 : 0;
    this.refetchedAt = this.head;
    if (!stuck) return this.start(this.head);
    this.refetch = setTimeout(
      () => {
        this.refetch = null;
        if (!this.closed && this.refetching) this.start(this.head);
      },
      (this.o.retryMs ?? RETRY_MS) * 2 ** Math.min(this.refetchFails - 1, MAX_BACKOFF_STEPS),
    );
  }

  private subRefused(th: string | undefined, error: string, retryAfter: number | undefined): void {
    if (th === this.th) this.refetching = false;
    if (th !== this.th || this.ready || this.resub) return;
    this.refusedWith = error;
    const wait = Math.max((retryAfter ?? 0) * 1000, (this.o.retryMs ?? RETRY_MS) * 2 ** Math.min(this.subFails++, MAX_BACKOFF_STEPS));
    this.resub = setTimeout(() => {
      this.resub = null;
      if (!this.closed && !this.ready) this.start(this.head);
    }, wait);
  }

  private async take(f: DocIn): Promise<void> {
    if (this.closed) return;
    if (f.t === "err") {
      if (f.id === undefined) return this.subRefused(f.th, f.error, f.retryAfter);
      if (f.id && f.id === this.snapping?.id) {
        this.snapping = null;
        this.refusedWith = f.error;
        const wait = (this.o.retryMs ?? RETRY_MS) * 2 ** Math.min(this.snapFails++, MAX_BACKOFF_STEPS);
        if (this.big.size) setTimeout(() => void this.queue(() => this.compact()), wait);
        return;
      }
      if (!f.id || !this.inFlight.has(f.id)) return;
      const update = this.inFlight.get(f.id)!;
      const id = f.id;
      this.refusedWith = f.error;
      if (f.error === DOC_COMPACT) {
        this.big.add(id);
        return this.compact();
      }
      return this.retry(update, id);
    }
    if (f.t === "ack") {
      if (f.id === this.snapping?.id) {
        for (const id of this.snapping.covers) {
          this.inFlight.delete(id);
          this.big.delete(id);
        }
        this.snapping = null;
        this.snapFails = 0;
        this.refusedWith = null;
        if (this.big.size) await this.compact();
        return;
      }
      if (!this.inFlight.has(f.id)) return;
      this.landed(f.id, f.seq);
      if (f.compact) await this.compact();
      return;
    }
    if (f.th !== this.th) return;
    if (f.t === "doc.ready") {
      this.refetching = false;
      this.ready = true;
      this.known = Math.max(this.known, f.head);
      this.saw(0);
      this.subFails = 0;
      for (const done of this.waiters.splice(0)) done();
      if (this.resend) {
        this.resend = false;
        for (const [id, update] of this.inFlight) void this.queue(() => this.post(update, id));
      }
      if (this.stale || this.big.size) await this.compact();
      return;
    }
    if (!f.snap && (f.dseq <= this.head || this.seen.has(f.dseq))) return;
    const update = await this.open(f.iv, f.ct, f.e);
    if (f.snap) this.saw(0, f.dseq);
    else this.saw(f.dseq);
    if (update === NO_KEY) {
      if (!this.hole || f.dseq < this.hole.dseq) this.hole = { dseq: f.dseq, e: f.e };
      return;
    }
    if (!update) {
      if (this.skipped === null || f.dseq < this.skipped) this.skipped = f.dseq;
    } else {
      for (const [id, mine] of this.inFlight) if (!f.snap && sameBytes(mine, update)) this.landed(id, f.dseq);
      Y.applyUpdate(this.doc, update, REMOTE);
    }
    await this.refill();
  }
}
