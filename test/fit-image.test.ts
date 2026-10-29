import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { MAX_IMAGE_SIDE, capped, fitImage, shrinkBy, type Shot } from "@kiwi/core/fit-image.ts";
import { shrinkImage } from "@kiwi/core/node/shrink-image.ts";
import { MAX_IMAGE_BYTES } from "@kiwi/core/protocol.ts";
import { loadImages } from "../src/attach.ts";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
}

function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const at = y * (width * 3 + 1) + 1 + x * 3;
      rows[at] = r;
      rows[at + 1] = g;
      rows[at + 2] = b;
    }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array())]);
}

function noise(seed: number): () => number {
  let s = seed;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 16) & 0xff;
}

const fake =
  (bytesPerPixel: (quality: number) => number, seen: Shot[] = []) =>
  async (shot: Shot) => {
    seen.push(shot);
    return { size: Math.round(shot.width * shot.height * bytesPerPixel(shot.quality)), shot };
  };

describe("fitting an image to the size limit", () => {
  test("a big screenshot keeps every pixel and takes the best quality that fits", async () => {
    const got = await fitImage(
      3412,
      2142,
      MAX_IMAGE_BYTES,
      0.1,
      fake((q) => q * 0.1),
    );
    expect(got.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect([got.shot.width, got.shot.height]).toEqual([3412, 2142]);
    expect(got.shot.quality).toBeGreaterThan(0.3);
    const better = await fake((q) => q * 0.1)({ ...got.shot, quality: got.shot.quality + 0.03 });
    expect(better.size).toBeGreaterThan(MAX_IMAGE_BYTES);
  });

  test("pixels go only when even the lowest quality is too big, and the result still fits", async () => {
    const seen: Shot[] = [];
    const got = await fitImage(
      4000,
      3000,
      MAX_IMAGE_BYTES,
      0.1,
      fake(() => 0.5, seen),
    );
    expect(got.size).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(got.shot.width).toBeLessThan(4000);
    const shrunk = seen.findIndex((s) => s.width < 4000);
    expect(shrunk).toBeGreaterThan(0);
    expect(seen.slice(0, shrunk).some((s) => s.quality === 0.1)).toBe(true);
  });

  test("an encoder that never fits still ends instead of looping", async () => {
    await expect(fitImage(5000, 5000, MAX_IMAGE_BYTES, 0.1, async () => null)).rejects.toThrow(/couldn't be encoded/);
    await expect(fitImage(5000, 5000, 10, 0.1, async (shot: Shot) => ({ size: shot.width * shot.height }))).resolves.toEqual({ size: 9 });
  });

  test("the side cap fits the longest side, never upscales, and never makes a side zero", () => {
    expect(capped(8192, 4096)).toEqual({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE / 2 });
    expect(capped(800, 600)).toEqual({ width: 800, height: 600 });
    expect(capped(100_000, 1)).toEqual({ width: MAX_IMAGE_SIDE, height: 1 });
    expect(shrinkBy(null, 100)).toBe(0.5);
    expect(shrinkBy(101, 100)).toBe(0.9);
    expect(shrinkBy(10_000, 100)).toBe(0.5);
  });
});

describe("shrinking with Bun's encoder", () => {
  setDefaultTimeout(30_000);

  test("a big image that quality alone can fit keeps every pixel, as webp", async () => {
    const input = png(4000, 2600, (x, y) => [Math.round((x * 255) / 4000), Math.round((y * 255) / 2600), 128]);
    expect(input.length).toBeGreaterThan(MAX_IMAGE_BYTES);
    const out = await shrinkImage(input, MAX_IMAGE_BYTES);
    expect(out.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(await new Bun.Image(out.bytes).metadata()).toEqual({ width: 4000, height: 2600, format: "webp" });
  });

  test("pure noise still fits, at fewer pixels", async () => {
    const rand = noise(3);
    const out = await shrinkImage(
      png(1600, 1600, () => [rand(), rand(), rand()]),
      MAX_IMAGE_BYTES,
    );
    expect(out.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect((await new Bun.Image(out.bytes).metadata()).width).toBeLessThan(1600);
  });

  test("kiwi send --image compresses a big file instead of refusing it, and leaves a small one alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-fit-"));
    try {
      const rand = noise(11);
      const big = join(dir, "shot.png");
      writeFileSync(
        big,
        png(1200, 1200, () => [rand(), rand(), rand()]),
      );
      const small = join(dir, "tiny.png");
      writeFileSync(
        small,
        png(4, 4, () => [1, 2, 3]),
      );
      const [a, b] = await loadImages([big, small]);
      expect(a?.name).toBe("shot.webp");
      expect(a?.mime).toBe("image/webp");
      expect(Buffer.from(a?.data ?? "", "base64").length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
      expect(b).toEqual({ name: "tiny.png", mime: "image/png", data: png(4, 4, () => [1, 2, 3]).toString("base64") });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
