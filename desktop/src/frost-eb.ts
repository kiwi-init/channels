import type { Pointer } from "bun:ffi";

import { frostWindow, lookSetting, mac, windowAppearance } from "./native-eb.ts";

const APPEARANCES: Record<string, number> = { light: 1, dark: 2 };

const frostOn = mac && lookSetting("ChannelsFrost") === "1";

export const lookMarks = (): string => (frostOn ? `document.documentElement.dataset.frost = "";\n` : "");

export function followTheme(win: Pointer, appearance: string): void {
  if (frostOn) windowAppearance(win, APPEARANCES[appearance] ?? 0);
}

export function frost(win: Pointer): void {
  if (frostOn) frostWindow(win);
}
