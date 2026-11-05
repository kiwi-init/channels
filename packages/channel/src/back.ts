import type { Unread } from "@kiwi/core/cache-row.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { OlderRows } from "../../../desktop/src/bridge.ts";
import { historyDb as db, type CachedRow } from "./history.ts";

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
