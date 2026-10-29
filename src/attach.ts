// Loading local image files into message attachments. Bun/Node only: reads
// from disk, so the web app and the Worker never import this.

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { home } from "./config.ts";
import type { OutgoingImage } from "@kiwi/core/client/images.ts";
import { MAX_FULL_IMAGE_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES, PREVIEW_IMAGE_BYTES, type InlineImage, type RasterMime } from "@kiwi/core/protocol.ts";
import { canShrink, shrinkToJpeg, type Step } from "./shrink.ts";

const MIME: Record<string, RasterMime> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
}

const PREVIEW: Step[] = [
  { longest: 1024, quality: 60 },
  { longest: 800, quality: 50 },
  { longest: 640, quality: 45 },
  { longest: 480, quality: 40 },
];
const SMALL: Step[] = [
  { longest: 2048, quality: 80 },
  { longest: 1600, quality: 70 },
  { longest: 1280, quality: 60 },
  { longest: 1024, quality: 55 },
  { longest: 800, quality: 50 },
];
const FULL: Step[] = [
  { share: 1, quality: 85 },
  { share: 0.8, quality: 85 },
  { share: 0.64, quality: 80 },
  { share: 0.5, quality: 80 },
];

const asJpeg = (name: string): string => `${name.replace(/\.[A-Za-z0-9]{1,5}$/, "") || "image"}.jpg`;

const noTool = "shrinking needs sips (macOS) or ImageMagick";

function big(p: string, mime: RasterMime, raw: Buffer, small: boolean): OutgoingImage {
  const name = basename(p);
  if (small) {
    const shrunk = shrinkToJpeg(p, MAX_IMAGE_BYTES, SMALL);
    if (!shrunk) throw new Error(`${p} is ${kb(raw.length)} and --small sends at most ${kb(MAX_IMAGE_BYTES)}; ${canShrink() ? "it didn't shrink that far" : noTool}`);
    return { name: asJpeg(name), mime: "image/jpeg", data: shrunk.toString("base64") };
  }
  const reencoded = raw.length > MAX_FULL_IMAGE_BYTES ? shrinkToJpeg(p, MAX_FULL_IMAGE_BYTES, FULL) : null;
  if (raw.length > MAX_FULL_IMAGE_BYTES && !reencoded)
    throw new Error(`${p} is ${kb(raw.length)} (limit ${kb(MAX_FULL_IMAGE_BYTES)}); ${canShrink() ? "it didn't fit even at half size" : `${noTool}, or shrink it first`}`);
  const full = reencoded ? { name: asJpeg(name), mime: "image/jpeg" as const, data: reencoded.toString("base64") } : { name, mime, data: raw.toString("base64") };
  const preview = shrinkToJpeg(p, PREVIEW_IMAGE_BYTES, PREVIEW);
  return preview
    ? { name: full.name, mime: "image/jpeg", data: preview.toString("base64"), full: { mime: full.mime, data: full.data } }
    : { name: full.name, mime: full.mime, full: { mime: full.mime, data: full.data } };
}

/** Read image files into attachments: inline up to the inline cap, else full size beside a preview (or shrunk, with `small`). Throws a plain Error naming the problem. */
export function loadImages(paths: string[], { small = false }: { small?: boolean } = {}): OutgoingImage[] {
  if (paths.length > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES} images per message`);
  return paths.map((p) => {
    if (!existsSync(p)) throw new Error(`no such image: ${p}`);
    if (!statSync(p).isFile()) throw new Error(`not a file: ${p}`);
    const mime = MIME[extname(p).toLowerCase()];
    if (!mime) throw new Error(`${p}: image must be png, jpg, gif or webp`);
    const raw = readFileSync(p);
    if (raw.length > MAX_IMAGE_BYTES) return big(p, mime, raw, small);
    const inline: InlineImage = { name: basename(p), mime, data: raw.toString("base64") };
    return inline;
  });
}

/** True when `child` is `parent` or a directory inside it, by path spelling (the directory may not exist yet). */
function inside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** chmod `dir` and each parent up through `root`. Stops at `root`. Skips anything that isn't a real directory. */
function lockDirs(dir: string, root: string): void {
  const top = resolve(root);
  for (let cur = resolve(dir); ;) {
    if (cur !== top && !inside(top, cur)) break;
    try {
      if (lstatSync(cur).isDirectory()) chmodSync(cur, 0o700);
    } catch {
      // A directory this user can't chmod keeps its mode; the images in it are still written 0600.
    }
    if (cur === top || dirname(cur) === cur) break;
    cur = dirname(cur);
  }
}

/** Write message #seq's images into `dir` as `#<seq>-<name>`; returns the paths. Files are 0600. Directories under ~/.kiwi/downloads are 0700; a directory the caller named keeps its own mode. */
export function saveImages(seq: number, imgs: InlineImage[], dir: string): string[] {
  const downloads = join(home(), "downloads");
  const locked = inside(downloads, dir);
  mkdirSync(dir, locked ? { recursive: true, mode: 0o700 } : { recursive: true });
  if (locked) lockDirs(dir, downloads);
  return imgs.map((img) => {
    const safe = img.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "image";
    const path = join(dir, `#${seq}-${safe}`);
    writeFileSync(path, Buffer.from(img.data, "base64"), { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Written with mode 0600 already; a mode this user can't set must not fail saving the image.
    }
    return path;
  });
}
