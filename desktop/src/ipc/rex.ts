import { ipcMain } from "electron";

import { readRexSeat, type RexSeat } from "@kiwi/core/terminals.ts";
import type { RexShowResult } from "../bridge.ts";
import { runKiwi } from "./kiwi.ts";

function seats(stdout: string): RexSeat[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // The CLI writes one array and nothing else; anything else is not a seat list.
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(readRexSeat).filter((s): s is RexSeat => s !== null);
}

function result(stdout: string): RexShowResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // A refused or crashed call says nothing we can show; the item says Rex didn't open it.
    return { ok: false, why: "failed" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, why: "failed" };
  const got = parsed as Record<string, unknown>;
  if (got["ok"] === true) return { ok: true };
  const why = got["why"];
  return { ok: false, why: why === "no-rex" || why === "no-server" || why === "no-app" || why === "remote-control" ? why : "failed" };
}

export function wireRexIpc(): void {
  ipcMain.handle("kiwi:rex-seats", async (): Promise<RexSeat[]> => {
    const listed = await runKiwi(["rex", "seats", "--json"]);
    return listed.code === 0 ? seats(listed.stdout) : [];
  });
  ipcMain.handle("kiwi:rex-show", async (_e, value: unknown): Promise<RexShowResult> => {
    const s = readRexSeat(value);
    if (!s) return { ok: false, why: "failed" };
    const done = await runKiwi(["rex", "show", "--server", s.server, "--session", s.session, "--block", s.block]);
    return done.code === 0 ? result(done.stdout) : { ok: false, why: "failed" };
  });
}
