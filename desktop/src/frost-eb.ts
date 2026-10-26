import type { Pointer } from "bun:ffi";

import { blursBehind } from "./compositor.ts";
import { frostAllowed, frostWindow, mac, windowAppearance } from "./native-eb.ts";

const APPEARANCES: Record<string, number> = { light: 1, dark: 2 };

export const lookMarks = (): string =>
  mac && frostAllowed() ? `document.documentElement.dataset.frost = "";\n` : blursBehind(process.env, process.platform) ? `document.documentElement.dataset.frost = "tint";\n` : "";

export function followTheme(win: Pointer, appearance: string): void {
  if (mac) windowAppearance(win, APPEARANCES[appearance] ?? 0);
}

export function frost(win: Pointer, changed: (on: boolean) => void): void {
  if (mac) frostWindow(win, changed);
}
