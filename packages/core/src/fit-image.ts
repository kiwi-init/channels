export const MAX_IMAGE_SIDE = 4096;

const TOP = 0.92;
const STEPS = 5;

export const FLOORS = { "image/webp": 0.1, "image/jpeg": 0.25 } as const;
export type LossyMime = keyof typeof FLOORS;

export interface Shot {
  width: number;
  height: number;
  quality: number;
}

export function capped(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function shrinkBy(size: number | null, limit: number): number {
  if (size === null) return 0.5;
  return Math.min(0.9, Math.max(0.5, Math.sqrt(limit / size) * 0.95));
}

export async function fitImage<T extends { size: number }>(width: number, height: number, limit: number, floor: number, encode: (shot: Shot) => Promise<T | null>): Promise<T> {
  let size = capped(width, height);
  for (;;) {
    const at = (quality: number) => encode({ ...size, quality });
    const top = await at(TOP);
    if (top && top.size <= limit) return top;
    let best: T | null = null;
    let lo = floor;
    let hi = TOP;
    for (let i = 0; i < STEPS; i++) {
      const mid = (lo + hi) / 2;
      const got = await at(mid);
      if (got && got.size <= limit) {
        best = got;
        lo = mid;
      } else hi = mid;
    }
    if (best) return best;
    const low = await at(floor);
    if (low && low.size <= limit) return low;
    if (size.width === 1 && size.height === 1) throw new Error("the image couldn't be encoded");
    const k = shrinkBy(low?.size ?? null, limit);
    size = { width: Math.max(1, Math.floor(size.width * k)), height: Math.max(1, Math.floor(size.height * k)) };
  }
}
