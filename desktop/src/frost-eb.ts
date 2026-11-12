import type { Pointer } from "bun:ffi";

import { blursBehind, glassOf, tiles } from "./compositor.ts";
import { clearWindow, frostAllowed, frostWindow, mac, windowAppearance } from "./native-eb.ts";

const APPEARANCES: Record<string, number> = { light: 1, dark: 2 };

const frostMark = (): string =>
  blursBehind(process.env, process.platform) ? `document.documentElement.dataset.frost = "tint";\n` : process.platform === "linux" ? `document.documentElement.dataset.frost = "image";\n` : "";

const wmMark = (): string => (process.platform === "linux" ? `document.documentElement.dataset.wm = "${tiles(process.env) ? "tiling" : "floating"}";\n` : "");

const glassMark = (): string => {
  const glass = glassOf(process.env, process.platform, mac && frostAllowed());
  return glass ? `document.documentElement.dataset.glass = "${glass}";\n` : "";
};

export const lookMarks = (): string => frostMark() + glassMark() + wmMark();

export function glassWindow(win: Pointer, changed: (on: boolean) => void): void {
  if (mac) frostWindow(win, changed);
  else if (blursBehind(process.env, process.platform)) clearWindow();
}

export function followTheme(win: Pointer, appearance: string): void {
  if (mac) windowAppearance(win, APPEARANCES[appearance] ?? 0);
}
