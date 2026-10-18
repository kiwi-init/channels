import { ipcMain } from "electron";

import { cleanPersonalities, MAX_PERSONALITIES } from "@kiwi/core/personalities.ts";
import { mutate } from "../store.ts";

export function wirePersonalitiesIpc(): void {
  ipcMain.handle("kiwi:personalities-set", (_e, list: unknown) => {
    if (!Array.isArray(list) || list.length > MAX_PERSONALITIES) throw new Error(`at most ${MAX_PERSONALITIES} personalities`);
    const clean = cleanPersonalities(list);
    if (clean.length !== list.length) throw new Error("a personality isn't valid: check its name, role, capabilities, areas and instructions");
    mutate((s) => {
      s.personalities = clean;
    });
  });
}
