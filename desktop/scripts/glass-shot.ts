import { mean, type Picture, type Rect } from "./shot-pixels.ts";

export interface GlassParts {
  top: Rect | null;
  side: Rect | null;
  page: Rect | null;
  glass: string | null;
  wallpaper: boolean;
}

export interface Tints {
  left: number | null;
  right: number | null;
  side: number | null;
  page: number | null;
}

export const glassParts = (): GlassParts => {
  const rect = (selector: string): Rect | null => {
    const r = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  };
  const page = document.documentElement;
  return { top: rect(".top"), side: rect(".side"), page: rect(".main"), glass: page.dataset["glass"] ?? null, wallpaper: page.style.getPropertyValue("--backdrop").startsWith("url(") };
};

export const originMark = (on: boolean): boolean => {
  document.getElementById("glass-origin")?.remove();
  if (on) {
    const mark = document.createElement("div");
    mark.id = "glass-origin";
    mark.style.cssText = "position:fixed;left:0;top:0;width:6px;height:6px;background:#f0f;z-index:2147483647";
    document.body.append(mark);
  }
  return true;
};

export function markedOrigin(p: Picture): { x: number; y: number } | null {
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const at = (y * p.width + x) * 3;
      if (p.rgb[at]! > 235 && p.rgb[at + 1]! < 30 && p.rgb[at + 2]! > 235 && p.rgb[at + 3]! > 235 && p.rgb[at + 4]! < 30) return { x, y };
    }
  return null;
}

export function tints(p: Picture, at: { x: number; y: number }, parts: GlassParts): Tints {
  const on = (r: Rect | null, inset = 0) => (r ? mean(p, { x: at.x + r.x + inset, y: at.y + r.y + inset, width: r.width - inset * 2, height: r.height - inset * 2 }) : null);
  const warmth = (r: Rect | null, inset = 0): number | null => {
    const m = on(r, inset);
    return m ? Math.round(m.r - m.b) : null;
  };
  const top = parts.top;
  const page = on(parts.page, 12);
  return {
    left: warmth(top && { ...top, width: top.width * 0.3 }),
    right: warmth(top && { ...top, x: top.x + top.width * 0.7, width: top.width * 0.3 }),
    side: warmth(parts.side, 8),
    page: page ? Math.round(Math.max(Math.abs(page.r - page.g), Math.abs(page.g - page.b), Math.abs(page.r - page.b))) : null,
  };
}
