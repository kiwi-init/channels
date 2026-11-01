import { b64url } from "@kiwi/core/crypto.ts";
import type { Message } from "@kiwi/core/protocol.ts";

import type { FoldInputs, IndexHit, SearchAsk, SearchCalls, Searched, SearchOp, SearchReply } from "./search-types.ts";

export interface SearchWorker {
  postMessage(ask: SearchAsk): void;
  terminate(): void;
  onReply(fn: (reply: SearchReply) => void): void;
  onExit(fn: (why: string) => void): void;
}

export interface IndexFile {
  file: string;
  key: string;
  roomId: string;
}

class WorkerGone extends Error {}

export interface SearchPlace {
  file(name: string): string;
  spawn(): SearchWorker;
}

export function bunSearchWorker(file: string): SearchWorker {
  const worker = new Worker(file);
  return {
    postMessage: (ask) => worker.postMessage(ask),
    terminate: () => worker.terminate(),
    onReply: (fn) => worker.addEventListener("message", (e: MessageEvent<SearchReply>) => fn(e.data)),
    onExit: (fn) => {
      worker.addEventListener("error", (e) => fn(e.message));
      worker.addEventListener("close", () => fn("exited"));
    },
  };
}

export async function indexKey(sk: string, roomId: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(sk), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode(roomId), info: enc.encode("kiwi-search-index") }, base, 256);
  return b64url(new Uint8Array(bits));
}

const IDLE_MS = 5 * 60_000;

type Args<K extends SearchOp> = SearchCalls[K]["args"];

export class SearchHost {
  private worker: SearchWorker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { done: (v: SearchCalls[SearchOp]["value"]) => void; fail: (e: Error) => void }>();
  private readonly files = new Map<string, IndexFile>();
  private readonly loaded = new Map<string, Promise<number>>();
  private readonly idle = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly spawn: () => SearchWorker,
    private readonly idleMs = IDLE_MS,
  ) {}

  open(code: string, at: IndexFile): Promise<number> {
    const had = this.files.get(code);
    if (!had || had.file !== at.file || had.key !== at.key || had.roomId !== at.roomId) this.loaded.delete(code);
    this.files.set(code, at);
    return this.ready(code);
  }

  async feed(code: string, messages: Message[], inputs: FoldInputs): Promise<number> {
    return (await this.call(code, "feed", { messages, inputs })).through;
  }

  async search(code: string, query: string, rooms: string[], limit: number, head: number): Promise<Searched> {
    const out = await this.call(code, "search", { query, rooms, limit }).catch((e: unknown) => {
      if (e instanceof WorkerGone) return null;
      throw e;
    });
    if (!out) return { state: "indexing", hits: [], through: 0 };
    return { state: out.through >= head ? "ready" : "indexing", hits: out.hits, through: out.through };
  }

  async around(code: string, seq: number, rooms: string[], span: number): Promise<IndexHit[] | null> {
    const out = await this.call(code, "around", { seq, rooms, span }).catch((e: unknown) => {
      if (e instanceof WorkerGone) return null;
      throw e;
    });
    return out ? out.hits : null;
  }

  async dropRoom(code: string, room: string): Promise<void> {
    await this.call(code, "dropRoom", { room });
  }

  async forget(code: string): Promise<void> {
    if (this.files.has(code)) await this.call(code, "forget", {}).catch(() => null);
    this.files.delete(code);
    this.loaded.delete(code);
    this.stopIdle(code);
  }

  stop(): void {
    this.worker?.terminate();
    this.gone("stopped");
    for (const t of this.idle.values()) clearTimeout(t);
    this.idle.clear();
  }

  private ready(code: string): Promise<number> {
    let p = this.loaded.get(code);
    if (!p) {
      const at = this.files.get(code);
      if (!at) return Promise.reject(new Error("this channel's search index isn't open"));
      p = this.send(code, "open", at).then((v) => v.through);
      p.catch(() => this.loaded.delete(code));
      this.loaded.set(code, p);
    }
    return p;
  }

  private async call<K extends SearchOp>(code: string, op: K, args: Args<K>): Promise<SearchCalls[K]["value"]> {
    await this.ready(code);
    const out = await this.send(code, op, args);
    this.touch(code);
    return out;
  }

  private send<K extends SearchOp>(code: string, op: K, args: Args<K>): Promise<SearchCalls[K]["value"]> {
    const w = this.alive();
    const id = this.nextId++;
    return new Promise<SearchCalls[K]["value"]>((done, fail) => {
      this.pending.set(id, { done: done as (v: SearchCalls[SearchOp]["value"]) => void, fail });
      w.postMessage({ id, op, code, ...args } as SearchAsk);
    });
  }

  private alive(): SearchWorker {
    if (this.worker) return this.worker;
    const w = this.spawn();
    w.onReply((r) => {
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (r.ok) p.done(r.value);
      else p.fail(new Error(r.error));
    });
    w.onExit((why) => {
      if (this.worker === w) this.gone(why);
    });
    this.worker = w;
    return w;
  }

  private gone(why: string): void {
    this.worker = null;
    this.loaded.clear();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.fail(new WorkerGone(`the search worker stopped: ${why}`));
  }

  private touch(code: string): void {
    this.stopIdle(code);
    this.idle.set(
      code,
      setTimeout(() => {
        this.idle.delete(code);
        if (!this.loaded.has(code) || !this.worker) return;
        this.loaded.delete(code);
        void this.send(code, "unload", {}).catch(() => null);
      }, this.idleMs),
    );
  }

  private stopIdle(code: string): void {
    const t = this.idle.get(code);
    if (t) clearTimeout(t);
    this.idle.delete(code);
  }
}
