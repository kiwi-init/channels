import type { ReadonlySignal, Signal } from "@preact/signals-core";
import type { Unread } from "@kiwi/core/cache-row.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { OlderRows } from "../../../desktop/src/bridge.ts";
import type { ChannelLink } from "./channel-ops.ts";
import { historyDb as db, type CachedRow } from "./history.ts";
import { holdAll } from "./image-bytes.ts";

export interface PageSource {
  older(before: number, limit: number): Promise<OlderRows>;
  open(rows: CachedRow[]): Promise<(Message | Unread | null)[]>;
}

export interface Page {
  messages: Message[];
  done: boolean;
}

const isMessage = (m: Message | Unread | null): m is Message => m !== null && !("unread" in m);

const below = (rows: readonly CachedRow[], before: number): CachedRow[] =>
  [...new Map(rows.filter((r) => Number.isSafeInteger(r.seq) && r.seq > 0 && r.seq < before).map((r) => [r.seq, r])).values()].sort((a, b) => a.seq - b.seq);

async function relayRows(roomId: string, memberPk: string, src: PageSource, before: number, limit: number): Promise<OlderRows> {
  const page = await src.older(before, limit);
  if (page.rows.length)
    await db()
      .putRows(roomId, memberPk, page.rows)
      .catch(() => {});
  return page;
}

export async function pageBefore(roomId: string, memberPk: string, before: number, size: number, src: PageSource): Promise<Page> {
  if (before <= 1) return { messages: [], done: true };
  let rows = below(await db().before(roomId, memberPk, before, size), before);
  let done = rows[0]?.seq === 1;
  if (rows.at(-1)?.seq !== before - 1) {
    const page = await relayRows(roomId, memberPk, src, before, size);
    rows = below(page.rows, before);
    done = page.done || rows[0]?.seq === 1;
  } else if (rows.length < size && !done && !(await db().floor(roomId, memberPk))) {
    const page = await relayRows(roomId, memberPk, src, rows[0]!.seq, size - rows.length).catch(() => null);
    if (page) {
      rows = below([...page.rows, ...rows], before);
      done = page.done || rows[0]?.seq === 1;
    }
  }
  if (!rows.length) return { messages: [], done: true };
  const opened = await src.open(rows);
  return { messages: opened.filter(isMessage).sort((a, b) => a.seq - b.seq), done };
}

export interface Paged {
  ch: ChannelLink;
  back: Signal<Message[]>;
  shown: ReadonlySignal<Message[]>;
  messages: ReadonlySignal<Message[]>;
  gone: ReadonlySignal<unknown>;
  page: number;
  reach: number;
}

export class Scrollback {
  private paging: Promise<boolean> | null = null;
  private done = false;
  private readonly holds = new Map<string, number>();

  constructor(private readonly p: Paged) {}

  private first = (): number | undefined => this.p.shown.peek()[0]?.seq;

  more(): Promise<boolean> {
    this.paging ??= this.once().finally(() => (this.paging = null));
    return this.paging;
  }

  private async once(): Promise<boolean> {
    const first = this.first();
    if (first === undefined || first <= 1 || this.done || this.p.gone.peek()) return false;
    const ch = this.p.ch;
    const { messages, done } = await pageBefore(ch.roomId, ch.pk, first, this.p.page, { older: (before, limit) => ch.olderRows(before, limit), open: (rows) => ch.openRows(rows) });
    if (this.first() !== first) return true;
    const older = holdAll(messages.filter((m) => m.seq < first));
    if (done) this.done = true;
    if (older.length) this.p.back.value = [...older, ...this.p.back.peek()];
    return !done;
  }

  async to(seq: number): Promise<boolean> {
    const has = () => (this.first() ?? Infinity) <= seq;
    const first = this.first();
    if (first === undefined || seq < 1 || first - seq > this.p.reach) return false;
    if (seq < (this.p.messages.peek()[0]?.seq ?? Infinity)) this.holds.set("to", seq);
    if (has()) return true;
    for (let tries = Math.ceil(this.p.reach / this.p.page) + 2; tries > 0 && !has(); tries--) if (!(await this.more().catch(() => false)) && !has()) return false;
    return has();
  }

  keep(key: string, seq: number | null): void {
    if (seq === null) this.holds.delete(key);
    else this.holds.set(key, seq);
    const floor = Math.min(Infinity, ...this.holds.values());
    const back = this.p.back.peek();
    if (!back.length || back[0]!.seq >= floor) return;
    this.p.back.value = back.filter((m) => m.seq >= floor);
    this.done = false;
  }
}
