import { describe, expect, test } from "bun:test";
import { backdropOf } from "../desktop/src/wallpaper-backdrop.ts";

const decode = (url: string) => {
  const bytes = Buffer.from(url.replace(/^data:image\/bmp;base64,/, ""), "base64");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  const row = Math.ceil((width * 3) / 4) * 4;
  const at = (x: number, y: number): [number, number, number] => {
    const i = 54 + (height - 1 - y) * row + x * 3;
    return [bytes[i + 2] ?? 0, bytes[i + 1] ?? 0, bytes[i] ?? 0];
  };
  return { bytes, width, height, at };
};

const split = (width: number, height: number): Uint8Array => {
  const px = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const warm = x < width / 2;
      px[i] = warm ? 240 : 20;
      px[i + 1] = warm ? 120 : 80;
      px[i + 2] = warm ? 30 : 230;
      px[i + 3] = 255;
    }
  return px;
};

describe("on desktops that don't blur, the app draws the wallpaper blurred behind its shell", () => {
  test("the backdrop is a BMP the page can show, the wallpaper's size", () => {
    const url = backdropOf(split(64, 36), 64, 36);
    expect(url?.startsWith("data:image/bmp;base64,")).toBe(true);
    const img = decode(url ?? "");
    expect(img.bytes[0]).toBe(0x42);
    expect(img.bytes[1]).toBe(0x4d);
    expect([img.width, img.height]).toEqual([64, 36]);
  });

  test("its colours stay where they are on the wallpaper, and their edge is soft", () => {
    const img = decode(backdropOf(split(64, 36), 64, 36) ?? "");
    const [lr, , lb] = img.at(4, 18);
    const [rr, , rb] = img.at(60, 18);
    expect(lr).toBeGreaterThan(lb);
    expect(rb).toBeGreaterThan(rr);
    const [mr] = img.at(32, 18);
    expect(mr).toBeGreaterThan(40);
    expect(mr).toBeLessThan(220);
  });

  test("too few pixels give no backdrop", () => {
    expect(backdropOf(new Uint8Array(10), 64, 36)).toBeNull();
    expect(backdropOf(new Uint8Array(), 0, 0)).toBeNull();
  });
});
