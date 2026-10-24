import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { DroppedFile } from "./bridge.ts";

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

export const MAX_DROPPED_FILES = 8;
export const MAX_DROPPED_BYTES = 25 * 1024 * 1024;

export async function readDropped(paths: readonly string[]): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  for (const p of paths.slice(0, MAX_DROPPED_FILES)) {
    const name = path.basename(p);
    const type = IMAGE_TYPES[path.extname(p).toLowerCase()];
    if (!type) {
      out.push({ name, refused: `${name} isn’t a PNG, JPEG, GIF, or WebP.` });
      continue;
    }
    const s = await stat(p).catch(() => null);
    if (!s?.isFile()) continue;
    if (s.size > MAX_DROPPED_BYTES) {
      out.push({ name, refused: `${name} is over ${MAX_DROPPED_BYTES / 1024 / 1024} MB.` });
      continue;
    }
    const data = await readFile(p).catch(() => null);
    if (data) out.push({ name, type, data: data.toString("base64") });
  }
  return out;
}
