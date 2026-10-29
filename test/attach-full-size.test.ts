import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { loadImages } from "../src/attach.ts";
import { canShrink } from "../src/shrink.ts";
import { MAX_FULL_IMAGE_BYTES, MAX_IMAGE_BYTES, PREVIEW_IMAGE_BYTES } from "@kiwi/core/protocol.ts";

const dir = mkdtempSync(join(tmpdir(), "kiwi-attach-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Buffer): number => (bytes.reduce((c, b) => crcTable[(c ^ b) & 0xff]! ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
}

function noisePng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let i = 0; i < rows.length; i++) rows[i] = i % (width * 3 + 1) === 0 ? 0 : (Math.random() * 256) | 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const write = (name: string, bytes: Buffer): string => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

test("an image over the inline cap goes full size, byte for byte, with a small JPEG preview when the system can make one", () => {
  const png = noisePng(500, 400);
  expect(png.length).toBeGreaterThan(MAX_IMAGE_BYTES);
  expect(png.length).toBeLessThan(MAX_FULL_IMAGE_BYTES);
  const [img] = loadImages([write("noise.png", png)]);
  expect(img?.full).toEqual({ mime: "image/png", data: png.toString("base64") });
  expect(img?.name).toBe("noise.png");
  if (canShrink()) {
    expect(img?.mime).toBe("image/jpeg");
    expect(Buffer.from(img!.data!, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(Buffer.from(img!.data!, "base64").length).toBeLessThanOrEqual(PREVIEW_IMAGE_BYTES);
  } else {
    expect(img).toEqual({ name: "noise.png", mime: "image/png", full: { mime: "image/png", data: png.toString("base64") } });
  }
});

test("--small shrinks under the inline cap, and says what's missing when it can't", () => {
  const path = write("small.png", noisePng(500, 400));
  if (!canShrink()) return expect(() => loadImages([path], { small: true })).toThrow(/sips \(macOS\) or ImageMagick/);
  const [img] = loadImages([path], { small: true });
  expect(img?.full).toBeUndefined();
  expect(img?.name).toBe("small.jpg");
  expect(Buffer.from(img!.data!, "base64").length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
});

test("a small image still rides inline as it is", () => {
  const png = noisePng(40, 40);
  expect(loadImages([write("tiny.png", png)])).toEqual([{ name: "tiny.png", mime: "image/png", data: png.toString("base64") }]);
});
