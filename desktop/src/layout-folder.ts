import path from "node:path";

import type { LayoutArea, LayoutsView, LayoutView } from "./bridge.ts";
import { isRecord, nameOf, readJsonFolder } from "./json-folder.ts";

const AREAS: readonly LayoutArea[] = ["rail", "sidebar", "chat", "panel"];
const SIZES: Record<keyof LayoutView["widths"], readonly [number, number]> = { rail: [48, 120], sidebar: [160, 480], panel: [320, 760] };
const MAX_LAYOUTS = 100;

export const layoutsDir = (home: string): string => path.join(home, "layouts");

const isArea = (v: unknown): v is LayoutArea => AREAS.includes(v as LayoutArea);

const sized = (k: string): k is keyof LayoutView["widths"] => Object.hasOwn(SIZES, k);

export function layoutOf(file: string, raw: unknown): LayoutView | string {
  if (!isRecord(raw)) return "isn't a JSON object";
  const list = raw["areas"];
  if (!Array.isArray(list)) return 'needs "areas", left to right, like ["rail", "sidebar", "chat", "panel"]';
  const areas: LayoutArea[] = [];
  for (const a of list) {
    if (!isArea(a)) return `has ${JSON.stringify(a)} in "areas": the areas are rail, sidebar, chat and panel`;
    if (areas.includes(a)) return `has "${a}" twice in "areas"`;
    areas.push(a);
  }
  if (!areas.includes("chat")) return 'needs "chat" in "areas"';
  const rail = areas.indexOf("rail");
  if (rail > 0 && rail < areas.length - 1) return 'puts "rail" between areas: it goes first or last';
  const widths: LayoutView["widths"] = {};
  const given = raw["widths"] ?? {};
  if (!isRecord(given)) return '"widths" isn\'t an object like { "sidebar": 280 }';
  for (const [k, v] of Object.entries(given)) {
    if (!sized(k)) return `has "widths.${k}": only rail, sidebar and panel take a width`;
    const [min, max] = SIZES[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return `"widths.${k}" isn't a whole number from ${min} to ${max}`;
    widths[k] = v;
  }
  return { file, name: nameOf(file, raw), areas, widths };
}

export function readLayouts(dir: string): LayoutsView {
  const { items, skipped } = readJsonFolder(dir, layoutOf, MAX_LAYOUTS, "layouts");
  return { dir, layouts: items, skipped };
}
