import { ipcMain } from "electron";

import { REX_UNKNOWN, type RexStatus } from "@kiwi/core/terminals.ts";
import { rexStatusOf } from "../rex-status.ts";
import { runKiwi } from "./kiwi.ts";

async function rexStatus(): Promise<RexStatus> {
  const got = await runKiwi(["rex", "status", "--json"]);
  return got.code === 0 ? rexStatusOf(got.stdout) : REX_UNKNOWN;
}

async function rexSwitch(to: "on" | "off"): Promise<RexStatus> {
  const done = await runKiwi(["rex", to]);
  if (done.code !== 0) throw new Error(done.stderr.trim().split("\n").at(-1) || `kiwi rex ${to} didn't finish`);
  return rexStatus();
}

export function wireRexIpc(): void {
  ipcMain.handle("kiwi:rex-status", () => rexStatus());
  ipcMain.handle("kiwi:rex-install", () => rexSwitch("on"));
  ipcMain.handle("kiwi:rex-remove", () => rexSwitch("off"));
}
