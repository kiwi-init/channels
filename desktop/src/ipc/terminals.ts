import { ipcMain } from "electron";

import { readPlacedSeat, readShowResult, type PlacedSeat, type ShowResult, type TerminalId, type TerminalsStatus } from "@kiwi/core/terminals.ts";
import { terminalsOf } from "../terminals-status.ts";
import { runKiwi } from "./kiwi.ts";

type HelperId = Exclude<TerminalId, "app">;

const isHelperId = (v: unknown): v is HelperId => v === "rex" || v === "tmux";
const isTerminalId = (v: unknown): v is TerminalId => v === "app" || isHelperId(v);
const isSwitch = (v: unknown): v is "on" | "off" => v === "on" || v === "off";

async function terminals(): Promise<TerminalsStatus | null> {
  const got = await runKiwi(["terminal", "status", "--json"]);
  return got.code === 0 ? terminalsOf(got.stdout) : null;
}

async function change(args: string[]): Promise<TerminalsStatus | null> {
  const done = await runKiwi(args);
  if (done.code !== 0)
    throw new Error(
      done.stderr
        .trim()
        .split("\n")
        .at(-1)
        ?.replace(/^kiwi: /, "") || `kiwi ${args.join(" ")} didn't finish`,
    );
  return terminals();
}

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

export function wireTerminalsIpc(): void {
  ipcMain.handle("kiwi:terminals", () => terminals());
  ipcMain.handle("kiwi:terminal-helpers", (_e, id: unknown, to: unknown) => {
    if (!isHelperId(id) || !isSwitch(to)) throw new Error("kiwi:terminal-helpers takes rex or tmux, and on or off");
    return change(["terminal", to === "on" ? "download" : "remove", id]);
  });
  ipcMain.handle("kiwi:terminal-prefer", (_e, id: unknown) => {
    if (!isTerminalId(id)) throw new Error("kiwi:terminal-prefer takes app, rex or tmux");
    return change(["terminal", "prefer", id]);
  });
  ipcMain.handle("kiwi:launches", (_e, to: unknown) => {
    if (!isSwitch(to)) throw new Error("kiwi:launches takes on or off");
    return change(["launches", to]);
  });
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
