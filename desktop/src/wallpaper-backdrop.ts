export const BACKDROP_WIDTH = 64;
export const BACKDROP_HEIGHT = 36;
const PASSES = 3;
const RADIUS = 2;

function boxBlur(src: Float32Array, width: number, height: number): Float32Array {
  const across = new Float32Array(src.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -RADIUS; k <= RADIUS; k++) sum += src[(y * width + Math.min(width - 1, Math.max(0, x + k))) * 3 + c] ?? 0;
        across[(y * width + x) * 3 + c] = sum / (RADIUS * 2 + 1);
      }
  const down = new Float32Array(src.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = -RADIUS; k <= RADIUS; k++) sum += across[(Math.min(height - 1, Math.max(0, y + k)) * width + x) * 3 + c] ?? 0;
        down[(y * width + x) * 3 + c] = sum / (RADIUS * 2 + 1);
      }
  return down;
}

function bmp(rgb: Float32Array, width: number, height: number): Uint8Array {
  const row = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + row * height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, row * height, true);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = ((height - 1 - y) * width + x) * 3;
      const to = 54 + y * row + x * 3;
      out[to] = Math.round(rgb[from + 2] ?? 0);
      out[to + 1] = Math.round(rgb[from + 1] ?? 0);
      out[to + 2] = Math.round(rgb[from] ?? 0);
    }
  return out;
}

export function backdropOf(rgba: Uint8Array, width: number, height: number): string | null {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return null;
  let rgb: Float32Array = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgba[i * 4 + c] ?? 0;
  for (let p = 0; p < PASSES; p++) rgb = boxBlur(rgb, width, height);
  return `data:image/bmp;base64,${Buffer.from(bmp(rgb, width, height)).toString("base64")}`;
}
