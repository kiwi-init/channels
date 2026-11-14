import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { mean, png, ppm } from "../desktop/scripts/shot-pixels.ts";

const chunk = (type: string, body: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body, Buffer.alloc(4)]);
};

function encoded(width: number, height: number, channels: 3 | 4, pixel: (x: number, y: number) => number[], filters: number[]): Buffer {
  const stride = width * channels;
  const rows: Buffer[] = [];
  let above = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = new Uint8Array(stride);
    for (let x = 0; x < width; x++) line.set(pixel(x, y).slice(0, channels), x * channels);
    const filter = filters[y % filters.length]!;
    const out = Buffer.alloc(stride + 1);
    out[0] = filter;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = above[x]!;
      const c = x >= channels ? above[x - channels]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      out[x + 1] = (line[x]! - (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth : 0)) & 255;
    }
    rows.push(out);
    above = line;
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = channels === 4 ? 6 : 2;
  const data = deflateSync(Buffer.concat(rows));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", data.subarray(0, 20)), chunk("IDAT", data.subarray(20)), chunk("IEND", Buffer.alloc(0))]);
}

const warmCool = (x: number, y: number): number[] => (x < 8 ? [240, 120 + y, 30, 255] : [40, 90, 230 - y, 255]);

describe("reading a screenshot's pixels in the desktop checks (T2107)", () => {
  test("a PNG reads back the same with every row filter, with and without alpha, across two data chunks", () => {
    for (const channels of [3, 4] as const) {
      const p = png(encoded(16, 10, channels, warmCool, [0, 1, 2, 3, 4]));
      expect([p.width, p.height]).toEqual([16, 10]);
      for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) expect([...p.rgb.subarray((y * 16 + x) * 3, (y * 16 + x) * 3 + 3)]).toEqual(warmCool(x, y).slice(0, 3));
    }
  });

  test("the mean of a part: warm on the left half, cool on the right, nothing outside the picture", () => {
    const p = png(encoded(16, 10, 3, warmCool, [4]));
    expect(mean(p, { x: 0, y: 0, width: 8, height: 1 })).toEqual({ r: 240, g: 120, b: 30 });
    expect(mean(p, { x: 8, y: 0, width: 80, height: 1 })).toEqual({ r: 40, g: 90, b: 230 });
    expect(mean(p, { x: 40, y: 40, width: 4, height: 4 })).toBeNull();
  });

  test("a binary PPM, as grim writes it", () => {
    const body = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const p = ppm(Buffer.concat([Buffer.from("P6\n2 2\n255\n"), body]));
    expect([p.width, p.height, [...p.rgb]]).toEqual([2, 2, [...body]]);
    expect(mean(p, { x: 1, y: 0, width: 1, height: 2 })).toEqual({ r: 7, g: 8, b: 9 });
    expect(() => ppm(Buffer.from("P3\n2 2\n255\n"))).toThrow();
  });
});
