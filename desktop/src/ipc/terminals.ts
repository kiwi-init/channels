import { ipcMain } from "electron";

import type { TerminalId, TerminalsStatus } from "@kiwi/core/terminals.ts";
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
}
