import type { Pointer } from "bun:ffi";

import { frostWindow, lookSetting, mac, windowAppearance } from "./native-eb.ts";

const APPEARANCES: Record<string, number> = { light: 1, dark: 2 };

export const frostOn = mac && lookSetting("ChannelsFrost") === "1";

export function lookMarks(): string {
  const marks: string[] = [];
  if (frostOn) marks.push(`document.documentElement.dataset.frost = "";`);
  return marks.length ? `${marks.join("\n")}\n` : "";
}

export function followTheme(win: Pointer, appearance: string): void {
  if (frostOn) windowAppearance(win, APPEARANCES[appearance] ?? 0);
}

export function frost(win: Pointer): void {
  if (frostOn) frostWindow(win, 0);
}
