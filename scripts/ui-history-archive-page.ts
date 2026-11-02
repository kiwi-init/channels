import { packRow } from "@kiwi/core/cache-row.ts";
import { b64url } from "@kiwi/core/crypto.ts";
import { openRows } from "@kiwi/core/cache-row.ts";
import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import { backfill } from "../packages/channel/src/history-fill.ts";
import { forgetHistory, openCached, readCached, rememberRows } from "../packages/channel/src/history.ts";

const ROOM = "e".repeat(32);
const PK = "pk-archive";

function msg(seq: number): Message {
  return { v: PROTOCOL_VERSION, id: `id-${seq}`, from: "Ada", kind: "msg", body: `line ${seq}`, ts: 1_700_000_000_000 + seq, seq, rts: 1_800_000_000_000 + seq, sigOk: true };
}

async function run(): Promise<Record<string, boolean>> {
  const key = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const keys = { "1": key };
  const pack = (from: number, to: number) => Promise.all(Array.from({ length: to - from + 1 }, (_, i) => packRow(key, ROOM, 1, msg(from + i))));
  const open = (rows: Parameters<typeof openRows>[0]) => openRows(rows, ROOM, keys);
  const seqs = async () => (await openCached(ROOM, PK, open, 1_000_000)).opened.map((m) => m.seq);
  const out: Record<string, boolean> = {};

  await forgetHistory(ROOM, PK);
  await rememberRows(ROOM, PK, await pack(1, 2_500));
  const newest = await openCached(ROOM, PK, open, 2_000);
  out["a reload reads only the newest 2,000 rows"] = newest.stored === 2_000 && newest.opened[0]?.seq === 501 && newest.opened.at(-1)?.seq === 2_500;
  const shown = await readCached(ROOM, PK, open, 2_500, 2_000);
  out["the window shows the newest 2,000 in order"] = shown.messages.length === 2_000 && shown.messages[0]?.seq === 501 && shown.since === 2_500;
  out["the rows below the window stay as the archive"] = (await seqs()).length === 2_500;

  await forgetHistory(ROOM, PK);
  await rememberRows(ROOM, PK, await pack(1_000, 1_005));
  let asks = 0;
  const older = async (before: number, limit: number) => {
    asks++;
    const since = Math.max(0, before - 1 - limit);
    return { rows: await pack(since + 1, before - 1), done: since === 0 };
  };
  const quick = { hidden: () => false, wait: async () => {}, stopped: () => false };
  const filled = await backfill(ROOM, PK, { ...quick, older });
  const all = await seqs();
  out["backfill pages down to seq 1 in pages of 500"] = filled === "done" && asks === 2 && all.length === 1_005 && all[0] === 1 && all.every((s, i) => s === i + 1);
  out["a finished backfill asks the relay nothing next time"] = (await backfill(ROOM, PK, { ...quick, older })) === "done" && asks === 2;

  await forgetHistory(ROOM, PK);
  out["leaving drops the archive"] = (await seqs()).length === 0;
  await rememberRows(ROOM, PK, await pack(9, 9));
  out["after leaving, backfill starts over"] = (await backfill(ROOM, PK, { ...quick, older })) === "done" && asks === 3 && (await seqs()).length === 9;
  await forgetHistory(ROOM, PK);
  return out;
}

Object.assign(window, { archiveCheck: run });
