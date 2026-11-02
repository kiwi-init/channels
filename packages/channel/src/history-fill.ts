import type { OlderRows } from "../../../desktop/src/bridge.ts";
import { historyDb as db, type CachedRow } from "./history.ts";

interface Backfill {
  older(before: number, limit: number): Promise<OlderRows>;
  hidden(): boolean;
  wait(ms: number): Promise<void>;
  stopped(): boolean;
}

const BACKFILL_PAGE = 500;
const BACKFILL_GAP_MS = 2_000;
const BACKFILL_MAX_WAIT_MS = 5 * 60_000;
const BACKFILL_TRIES = 6;

export async function backfill(roomId: string, memberPk: string, b: Backfill): Promise<"done" | "stopped" | "failed"> {
  let pause = BACKFILL_GAP_MS;
  let failures = 0;
  for (;;) {
    if (b.stopped()) return "stopped";
    if (b.hidden()) {
      await b.wait(BACKFILL_GAP_MS);
      continue;
    }
    if (await db().floor(roomId, memberPk)) return "done";
    const oldest = await db().oldest(roomId, memberPk);
    if (oldest === null) return "stopped";
    if (oldest <= 1) {
      await db().putFloor(roomId, memberPk);
      return "done";
    }
    const page = await b.older(oldest, BACKFILL_PAGE).then(
      (p) => p,
      () => null,
    );
    if (!page) {
      if (++failures >= BACKFILL_TRIES) return "failed";
      pause = Math.min(pause * 2, BACKFILL_MAX_WAIT_MS);
      await b.wait(pause);
      continue;
    }
    failures = 0;
    pause = BACKFILL_GAP_MS;
    if (b.stopped()) return "stopped";
    if (page.rows.length) await db().putRows(roomId, memberPk, page.rows);
    if (page.done) {
      await db().putFloor(roomId, memberPk);
      return "done";
    }
    await b.wait(pause);
  }
}

interface Indexer {
  index(rows: CachedRow[]): Promise<number | null>;
  hidden(): boolean;
  wait(ms: number): Promise<void>;
  stopped(): boolean;
}

const INDEX_PAGE = 2_000;

export async function indexArchive(roomId: string, memberPk: string, x: Indexer): Promise<"done" | "stopped" | "waiting" | "unsupported"> {
  if (!(await db().floor(roomId, memberPk)) && ((await db().oldest(roomId, memberPk)) ?? 2) > 1) return "waiting";
  let through = await x.index([]);
  if (through === null) return "unsupported";
  for (;;) {
    if (x.stopped()) return "stopped";
    if (x.hidden()) {
      await x.wait(BACKFILL_GAP_MS);
      continue;
    }
    const rows = await db().after(roomId, memberPk, through, INDEX_PAGE);
    if (!rows.length) return "done";
    const next = await x.index(rows);
    if (next === null) return "unsupported";
    if (next <= through) return "done";
    through = next;
    await x.wait(0);
  }
}
