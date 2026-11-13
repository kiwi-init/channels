import * as Y from "yjs";
import { b64url, fromB64url, openWith, sealWith } from "../crypto.ts";
import type { Identity } from "../identity.ts";
import { DOC_THREAD_RE } from "../protocol.ts";
import { newDocId } from "./blocks.ts";
import { ThreadDoc, type DocIn, type DocKeys, type DocOut, type DocSaved } from "./thread-doc.ts";

const AWARE_TYPE = "doc.aw";
const AWARE_MS = 250;
const SAVE_MS = 1_000;

export interface DocStore {
  load: (th: string) => Promise<DocSaved | null>;
  save: (th: string, saved: DocSaved) => Promise<void>;
}

export interface ThreadKeys extends DocKeys {
  sealed?: true;
}

export interface HubOptions {
  roomId: string;
  me: Identity;
  keysFor: (thread: string) => ThreadKeys;
  sealAware: (payload: object) => Promise<{ iv: string; ct: string }>;
  announce: (thread: string, th: string) => Promise<void>;
  store?: DocStore | null;
  trusts?: (pk: string) => boolean;
  flushMs?: number;
  retryMs?: number;
  awareMs?: number;
  saveMs?: number;
}

interface Open {
  td: ThreadDoc;
  keys: ThreadKeys;
  saving: ReturnType<typeof setTimeout> | null;
  onUpdate: () => void;
}

const SEALED_AWARE = "~";
const awareAd = (roomId: string, th: string) => `kiwi-doc-aware\n${roomId}\n${th}`;

const isDocFrame = (f: { t?: unknown }): f is Extract<DocIn, { th: string }> => f.t === "doc" || f.t === "doc.ready";

const awareList = (x: unknown): [string, string][] | null => {
  const p = x as { type?: unknown; docs?: unknown } | null;
  if (p?.type !== AWARE_TYPE || !Array.isArray(p.docs) || p.docs.length > 64) return null;
  return p.docs.filter((d): d is [string, string] => Array.isArray(d) && d.length === 2 && typeof d[0] === "string" && typeof d[1] === "string");
};

export class DocHub {
  private readonly o: HubOptions;
  private readonly byThread = new Map<string, Open>();
  private readonly byTh = new Map<string, Open>();
  private readonly opening = new Map<string, Promise<ThreadDoc>>();
  private readonly sockets: ((raw: string) => void)[] = [];
  private readonly awareOut = new Map<string, { u: Uint8Array; keys: ThreadKeys }>();
  private awareTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(o: HubOptions) {
    this.o = o;
  }

  get size(): number {
    return this.byTh.size;
  }

  attach(send: (raw: string) => void): () => void {
    const was = this.sockets.at(-1);
    this.sockets.push(send);
    for (const { td } of this.byTh.values()) {
      was?.(JSON.stringify({ t: "doc.unsub", th: td.th } satisfies DocOut));
      td.reconnect();
    }
    return () => {
      const at = this.sockets.indexOf(send);
      if (at < 0) return;
      const wasActive = at === this.sockets.length - 1;
      this.sockets.splice(at, 1);
      if (wasActive && this.sockets.length) for (const { td } of this.byTh.values()) td.reconnect();
    };
  }

  has(thread: string): boolean {
    return this.byThread.has(thread);
  }

  open(thread: string, th?: string): Promise<ThreadDoc> {
    const had = this.byThread.get(thread);
    if (had && (!th || had.td.th === th)) return Promise.resolve(had.td);
    const key = `${thread}\u0000${th ?? ""}`;
    const busy = this.opening.get(key);
    if (busy) return busy;
    const made = this.make(thread, th ?? null, had ?? null).finally(() => this.opening.delete(key));
    this.opening.set(key, made);
    return made;
  }

  close(thread: string): Promise<void> {
    const open = this.byThread.get(thread);
    if (!open) return Promise.resolve();
    const saved = this.drop(open);
    this.byThread.delete(thread);
    this.byTh.delete(open.td.th);
    return saved;
  }

  closeAll(): void {
    for (const thread of [...this.byThread.keys()]) void this.close(thread);
    if (this.awareTimer) clearTimeout(this.awareTimer);
    this.awareTimer = null;
  }

  take(f: { t?: unknown; th?: unknown; id?: unknown }): boolean {
    if (isDocFrame(f)) {
      const open = typeof f.th === "string" ? this.byTh.get(f.th) : undefined;
      if (open) void open.td.receive(f);
      return true;
    }
    if (f.t === "err" && f.id === undefined) {
      const open = typeof f.th === "string" ? this.byTh.get(f.th) : undefined;
      if (open) void open.td.receive(f as DocIn);
      return !!open;
    }
    if ((f.t !== "ack" && f.t !== "err") || typeof f.id !== "string") return false;
    for (const { td } of this.byTh.values())
      if (td.owns(f.id)) {
        void td.receive(f as DocIn);
        return true;
      }
    return false;
  }

  awareIn(payload: unknown): boolean {
    const docs = awareList(payload);
    if (!docs) return false;
    for (const [th, u] of docs) {
      const open = this.byTh.get(th);
      if (open) void this.applyAware(open, u);
    }
    return true;
  }

  private async applyAware(open: Open, u: string): Promise<void> {
    let raw: string | null = u;
    if (!!open.keys.sealed !== u.startsWith(SEALED_AWARE)) return;
    if (open.keys.sealed) {
      raw = null;
      for (const key of await open.keys.opening(undefined)) if ((raw = await openWith(key, u.slice(SEALED_AWARE.length), awareAd(this.o.roomId, open.td.th)))) break;
    }
    if (!raw) return;
    try {
      open.td.applyAwareness(fromB64url(raw));
    } catch {
      // A cursor update that doesn't decode is dropped; the next one replaces it.
    }
  }

  private readonly send = (f: DocOut): void => {
    const s = this.sockets.at(-1);
    if (s) s(JSON.stringify(f));
  };

  private readonly queueAware = (th: string, u: Uint8Array): void => {
    const keys = this.byTh.get(th)?.keys;
    if (!keys) return;
    this.awareOut.set(th, { u, keys });
    if (!this.awareTimer) this.awareTimer = setTimeout(() => void this.flushAware(), this.o.awareMs ?? AWARE_MS);
  };

  private async flushAware(): Promise<void> {
    this.awareTimer = null;
    if (!this.awareOut.size || !this.sockets.length) return this.awareOut.clear();
    const out = [...this.awareOut];
    this.awareOut.clear();
    const docs = await Promise.all(
      out.map(async ([th, { u, keys }]) => {
        if (!keys.sealed) return [th, b64url(u)];
        const { key } = await keys.current();
        return [th, SEALED_AWARE + (await sealWith(key, b64url(u), awareAd(this.o.roomId, th)))];
      }),
    );
    const sealed = await this.o.sealAware({ type: AWARE_TYPE, docs });
    this.sockets.at(-1)?.(JSON.stringify({ t: "eph", ...sealed }));
  }

  private async make(thread: string, th: string | null, had: Open | null): Promise<ThreadDoc> {
    const id = th ?? newDocId();
    if (!DOC_THREAD_RE.test(id)) throw new Error(`not a doc id: ${id}`);
    const keys = this.o.keysFor(thread);
    const saved = th ? ((await this.o.store?.load(id)) ?? null) : null;
    const td = new ThreadDoc({
      roomId: this.o.roomId,
      th: id,
      me: this.o.me,
      keys,
      links: { send: this.send, aware: this.queueAware },
      saved,
      ...(this.o.trusts ? { trusts: this.o.trusts } : {}),
      ...(this.o.flushMs === undefined ? {} : { flushMs: this.o.flushMs }),
      ...(this.o.retryMs === undefined ? {} : { retryMs: this.o.retryMs }),
    });
    const open: Open = { td, keys, saving: null, onUpdate: () => this.queueSave(open) };
    td.doc.on("update", open.onUpdate);
    if (had) {
      Y.applyUpdate(td.doc, Y.encodeStateAsUpdate(had.td.doc));
      void this.drop(had);
      this.byTh.delete(had.td.th);
    }
    this.byThread.set(thread, open);
    this.byTh.set(id, open);
    if (this.sockets.length) td.start();
    if (!th) await this.o.announce(thread, id);
    return td;
  }

  private queueSave(open: Open): void {
    if (!this.o.store || open.saving) return;
    open.saving = setTimeout(() => {
      open.saving = null;
      void this.persist(open);
    }, this.o.saveMs ?? SAVE_MS);
  }

  private async persist(open: Open): Promise<void> {
    try {
      await this.o.store?.save(open.td.th, open.td.save());
    } catch {
      // The local copy only makes opening faster; the relay still has the doc.
    }
  }

  private drop(open: Open): Promise<void> {
    if (open.saving) clearTimeout(open.saving);
    open.saving = null;
    const saved = this.persist(open);
    open.td.doc.off("update", open.onUpdate);
    open.td.destroy();
    return saved;
  }
}
