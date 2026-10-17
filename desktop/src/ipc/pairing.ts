import { ipcMain } from "electron";

import type { PairAskView } from "../bridge.ts";
import { pairAnswer, pairBegin, pairCancel, pairPoll } from "../pairing.ts";

export function wirePairingIpc(): void {
  ipcMain.handle("kiwi:pair-begin", () => pairBegin());
  ipcMain.handle("kiwi:pair-poll", (): Promise<PairAskView | null> => pairPoll());
  ipcMain.handle("kiwi:pair-answer", (_e, accept: boolean) => pairAnswer(accept));
  ipcMain.handle("kiwi:pair-cancel", () => pairCancel());
}
