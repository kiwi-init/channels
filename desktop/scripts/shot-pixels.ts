import { inflateSync } from "node:zlib";

export type Rect = { x: number; y: number; width: number; height: number };
export type Rgb = { r: number; g: number; b: number };
export interface Picture {
  width: number;
  height: number;
  rgb: Uint8Array;
}

export function ppm(file: Uint8Array): Picture {
  const head = Buffer.from(file.subarray(0, 64)).toString("latin1").split(/\s+/);
  const width = Number(head[1]);
  const height = Number(head[2]);
  if (head[0] !== "P6" || !(width > 0) || !(height > 0) || file.length < width * height * 3) throw new Error("not a binary PPM");
  return { width, height, rgb: file.subarray(file.length - width * height * 3) };
}

export function png(file: Uint8Array): Picture {
  const bytes = Buffer.from(file);
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Buffer[] = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + size);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || (body[9] !== 2 && body[9] !== 6) || body[12] !== 0) throw new Error("only 8-bit RGB or RGBA PNGs that aren't interlaced are read here");
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === "IDAT") data.push(body);
    at += size + 12;
  }
  if (!channels) throw new Error("not a PNG");
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rgb = new Uint8Array(width * height * 3);
  const line = new Uint8Array(stride);
  const above = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = above[x]!;
      const c = x >= channels ? above[x - channels]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      line[x] = (raw[start + 1 + x]! + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth : 0)) & 255;
    }
    for (let x = 0; x < width; x++) for (let ch = 0; ch < 3; ch++) rgb[(y * width + x) * 3 + ch] = line[x * channels + ch]!;
    above.set(line);
  }
  return { width, height, rgb };
}

export function mean(p: Picture, r: Rect): Rgb | null {
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, Math.round(r.y)); y < Math.min(p.height, Math.round(r.y + r.height)); y++)
    for (let x = Math.max(0, Math.round(r.x)); x < Math.min(p.width, Math.round(r.x + r.width)); x++) {
      for (let ch = 0; ch < 3; ch++) sum[ch]! += p.rgb[(y * p.width + x) * 3 + ch]!;
      n += 1;
    }
  return n ? { r: sum[0]! / n, g: sum[1]! / n, b: sum[2]! / n } : null;
}
