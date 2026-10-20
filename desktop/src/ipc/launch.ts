import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";

import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import type { LaunchedView } from "../bridge.ts";
import { daemonHarnesses, daemonLaunch } from "../daemon-client.ts";
import { launchRequestOf } from "../launch-view.ts";
import { runKiwi } from "./rex.ts";

const ROOM = /^[A-Za-z0-9_-]{1,128}$/;

function folders(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    // The CLI writes one array and nothing else; anything else is no folders.
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string" && f.startsWith("/")).slice(0, 20) : [];
}

const PICK: OpenDialogOptions = { properties: ["openDirectory", "createDirectory"], buttonLabel: "Choose" };

export function wireLaunchIpc(): void {
  ipcMain.handle("kiwi:harnesses", (): Promise<HarnessRow[]> => daemonHarnesses().catch(() => []));
  ipcMain.handle("kiwi:seat-folders", async (_e, roomId: unknown): Promise<string[]> => {
    if (typeof roomId !== "string" || !ROOM.test(roomId)) return [];
    const listed = await runKiwi(["folders", "--room", roomId, "--json"]);
    return listed.code === 0 ? folders(listed.stdout) : [];
  });
  ipcMain.handle("kiwi:choose-folder", async (e): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await (win ? dialog.showOpenDialog(win, PICK) : dialog.showOpenDialog(PICK));
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  ipcMain.handle("kiwi:launch-agent", async (_e, value: unknown): Promise<LaunchedView> => {
    const req = launchRequestOf(value);
    if (!req) return { ok: false, why: "bad-request", detail: "the app sent a launch it can't check" };
    return daemonLaunch(req).catch((err: unknown) => ({ ok: false, why: "failed", detail: err instanceof Error ? err.message : String(err) }));
  });
}
