import type { Pointer } from "bun:ffi";

import { blursBehind, tiles } from "./compositor.ts";
import { frostAllowed, frostWindow, mac, windowAppearance } from "./native-eb.ts";

const APPEARANCES: Record<string, number> = { light: 1, dark: 2 };

const frostMark = (): string =>
  mac && frostAllowed()
    ? `document.documentElement.dataset.frost = "";\n`
    : blursBehind(process.env, process.platform)
      ? `document.documentElement.dataset.frost = "tint";\n`
      : process.platform === "linux"
        ? `document.documentElement.dataset.frost = "image";\n`
        : "";

const wmMark = (): string => (process.platform === "linux" ? `document.documentElement.dataset.wm = "${tiles(process.env) ? "tiling" : "floating"}";\n` : "");

export const lookMarks = (): string => frostMark() + wmMark();

export function followTheme(win: Pointer, appearance: string): void {
  if (mac) windowAppearance(win, APPEARANCES[appearance] ?? 0);
}

export function frost(win: Pointer, changed: (on: boolean) => void): void {
  if (mac) frostWindow(win, changed);
}
