import type { Pointer } from "bun:ffi";

import { frostWindow, lookSetting, mac } from "./native-eb.ts";

const APPEARANCES: Record<string, number> = { light: 1, dark: 2 };
const FONTS = new Set(["mono", "sf"]);

export const frostOn = mac && lookSetting("ChannelsFrost") === "1";

const font = lookSetting("ChannelsFont");

export function lookMarks(): string {
  const marks: string[] = [];
  if (frostOn) marks.push(`document.documentElement.dataset.frost = "";`);
  if (FONTS.has(font)) marks.push(`document.documentElement.dataset.font = ${JSON.stringify(font)};`);
  return marks.length ? `${marks.join("\n")}\n` : "";
}

export function frost(win: Pointer): void {
  if (frostOn) frostWindow(win, APPEARANCES[lookSetting("ChannelsAppearance")] ?? 0);
}
