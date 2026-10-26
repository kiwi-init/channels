const BINS = 24;
const MAX_TINTS = 5;
const MIN_APART = 30;
const MIN_SHARE = 0.03;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hslOf(r: number, g: number, b: number): Hsl {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rr ? ((gg - bb) / d + 6) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

function hexOf({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b]
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

interface Bin {
  weight: number;
  x: number;
  y: number;
  s: number;
  n: number;
}

export function tintsOf(rgba: Uint8Array): string[] {
  const bins: Bin[] = Array.from({ length: BINS }, () => ({ weight: 0, x: 0, y: 0, s: 0, n: 0 }));
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const a = rgba[i + 3] ?? 0;
    if (a < 128) continue;
    const c = hslOf(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0);
    total++;
    if (c.s < 0.18 || c.l < 0.12 || c.l > 0.9) continue;
    const bin = bins[Math.floor(c.h / (360 / BINS)) % BINS];
    if (!bin) continue;
    const w = c.s * (1 - Math.abs(2 * c.l - 1));
    const rad = (c.h * Math.PI) / 180;
    bin.weight += w;
    bin.x += Math.cos(rad) * w;
    bin.y += Math.sin(rad) * w;
    bin.s += c.s * w;
    bin.n++;
  }
  if (!total) return [];
  const picked: Hsl[] = [];
  for (const bin of [...bins].sort((a, b) => b.weight - a.weight)) {
    if (picked.length >= MAX_TINTS || bin.n / total < MIN_SHARE || bin.weight <= 0) break;
    const h = ((Math.atan2(bin.y, bin.x) * 180) / Math.PI + 360) % 360;
    if (picked.some((p) => apart(p.h, h) < MIN_APART)) continue;
    picked.push({ h, s: Math.min(Math.max(bin.s / bin.weight, 0.35), 0.75), l: 0.5 });
  }
  return picked.map(hexOf);
}
