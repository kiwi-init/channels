import { describe, expect, test } from "bun:test";
import { tintsOf } from "../desktop/src/wallpaper-tints.ts";

const image = (...areas: [number, [number, number, number]][]): Uint8Array => {
  const out: number[] = [];
  for (const [n, [r, g, b]] of areas) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return new Uint8Array(out);
};

const hue = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};

describe("a wallpaper's tints are its own main colours", () => {
  test("a blue sky over an orange dune gives a blue and an orange, the larger first", () => {
    const tints = tintsOf(image([360, [20, 127, 190]], [180, [200, 120, 50]], [36, [60, 60, 62]]));
    expect(tints).toHaveLength(2);
    expect(hue(tints[0]!)).toBeGreaterThan(190);
    expect(hue(tints[0]!)).toBeLessThan(215);
    expect(hue(tints[1]!)).toBeGreaterThan(20);
    expect(hue(tints[1]!)).toBeLessThan(40);
  });

  test("each tint is evened out to a mid lightness, so it reads as an accent in both themes", () => {
    for (const t of tintsOf(image([300, [10, 40, 70]], [276, [250, 210, 120]]))) {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(t.slice(i, i + 2), 16));
      const l = (Math.max(r!, g!, b!) + Math.min(r!, g!, b!)) / 2 / 255;
      expect(l).toBeGreaterThan(0.45);
      expect(l).toBeLessThan(0.55);
    }
  });

  test("a grey, black or white wallpaper has no tints to offer", () => {
    expect(tintsOf(image([200, [128, 128, 128]], [200, [5, 5, 5]], [176, [250, 250, 250]]))).toEqual([]);
    expect(tintsOf(new Uint8Array())).toEqual([]);
  });

  test("near hues fold into one tint, and a speck of colour isn't offered", () => {
    expect(tintsOf(image([300, [20, 120, 200]], [270, [30, 100, 210]]))).toHaveLength(1);
    expect(tintsOf(image([570, [128, 128, 128]], [6, [220, 30, 30]]))).toEqual([]);
  });

  test("at most five", () => {
    const hues: [number, number, number][] = [
      [220, 40, 40],
      [220, 160, 40],
      [140, 220, 40],
      [40, 220, 140],
      [40, 140, 220],
      [140, 40, 220],
      [220, 40, 160],
    ];
    expect(tintsOf(image(...hues.map((c): [number, [number, number, number]] => [80, c])))).toHaveLength(5);
  });
});
