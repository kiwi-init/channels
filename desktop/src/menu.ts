import { Menu } from "electron";

import type { TextStep } from "./text-size.ts";

export function setAppMenu(step: (s: TextStep) => void): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { label: "Make Text Normal Size", accelerator: "CmdOrCtrl+0", click: () => step("reset") },
          { label: "Make Text Bigger", accelerator: "CmdOrCtrl+Plus", click: () => step("bigger") },
          { label: "Make Text Smaller", accelerator: "CmdOrCtrl+-", click: () => step("smaller") },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}
