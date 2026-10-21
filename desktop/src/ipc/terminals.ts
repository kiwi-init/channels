import { ipcMain } from "electron";

import { readPlacedSeat, readShowResult, type PlacedSeat, type ShowResult } from "@kiwi/core/terminals.ts";
import { runKiwi } from "./kiwi.ts";

function answer(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    // The CLI writes one JSON value and nothing else; anything else is no answer.
    return null;
  }
}

function seats(stdout: string): PlacedSeat[] {
  const parsed = answer(stdout);
  return Array.isArray(parsed) ? parsed.map(readPlacedSeat).filter((s): s is PlacedSeat => s !== null) : [];
}

export function wireTerminalIpc(): void {
  ipcMain.handle("kiwi:seat-places", async (): Promise<PlacedSeat[]> => {
    const listed = await runKiwi(["terminal", "seats", "--json"]);
    return listed.code === 0 ? seats(listed.stdout) : [];
  });
  ipcMain.handle("kiwi:show-seat", async (_e, value: unknown): Promise<ShowResult> => {
    const seat = readPlacedSeat(value);
    if (!seat) return { ok: false, why: "failed" };
    const done = await runKiwi(["terminal", "show", "--seat", JSON.stringify(seat)]);
    return done.code === 0 ? readShowResult(answer(done.stdout)) : { ok: false, why: "failed" };
  });
}
