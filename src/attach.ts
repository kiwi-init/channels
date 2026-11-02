// Loading local image files into message attachments. Bun/Node only: reads
// from disk, so the web app and the Worker never import this.

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { home } from "./config.ts";
import { shrinkImage } from "@kiwi/core/node/shrink-image.ts";
import { MAX_FILE_BYTES, MAX_FILES, MAX_IMAGE_BYTES, MAX_IMAGES, type InlineImage, type RasterMime } from "@kiwi/core/protocol.ts";

const MIME: Record<string, RasterMime> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Read image files into attachments, compressing any over the size limit to fit it. Rejects with a plain Error naming the problem. */
export async function loadImages(paths: string[]): Promise<InlineImage[]> {
  if (paths.length > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES} images per message`);
  return Promise.all(
    paths.map(async (p) => {
      if (!existsSync(p)) throw new Error(`no such image: ${p}`);
      if (!statSync(p).isFile()) throw new Error(`not a file: ${p}`);
      const mime = MIME[extname(p).toLowerCase()];
      if (!mime) throw new Error(`${p}: image must be png, jpg, gif or webp`);
      const raw = readFileSync(p);
      if (raw.length <= MAX_IMAGE_BYTES) return { name: basename(p), mime, data: raw.toString("base64") };
      const out = await shrinkImage(raw, MAX_IMAGE_BYTES).catch((err: unknown) => {
        throw new Error(`${p} couldn't be read as an image`, { cause: err });
      });
      return { name: `${basename(p, extname(p))}.webp`, mime: out.mime, data: Buffer.from(out.bytes).toString("base64") };
    }),
  );
}

export interface LocalFile {
  name: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export function loadFiles(paths: string[]): LocalFile[] {
  if (paths.length > MAX_FILES) throw new Error(`at most ${MAX_FILES} files per message`);
  return paths.map((p) => {
    if (!existsSync(p)) throw new Error(`no such file: ${p}`);
    const st = statSync(p);
    if (!st.isFile()) throw new Error(`not a file: ${p}`);
    if (!st.size) throw new Error(`${p} is empty`);
    if (st.size > MAX_FILE_BYTES) throw new Error(`${p} is ${Math.round(st.size / (1024 * 1024))} MB; a file is at most ${MAX_FILE_BYTES / (1024 * 1024)} MB`);
    const raw = readFileSync(p);
    const bytes = new Uint8Array(raw.length);
    bytes.set(raw);
    return { name: basename(p), mime: Bun.file(p).type || "application/octet-stream", bytes };
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
  return saveAll(
    seq,
    imgs.map((img) => ({ name: img.name, bytes: Buffer.from(img.data, "base64") })),
    dir,
    "image",
  );
}

export function saveFiles(seq: number, files: { name: string; bytes: Uint8Array }[], dir: string): string[] {
  return saveAll(seq, files, dir, "file");
}

function saveAll(seq: number, items: { name: string; bytes: Uint8Array }[], dir: string, fallback: string): string[] {
  const downloads = join(home(), "downloads");
  const locked = inside(downloads, dir);
  mkdirSync(dir, locked ? { recursive: true, mode: 0o700 } : { recursive: true });
  if (locked) lockDirs(dir, downloads);
  return items.map((item) => {
    const safe = item.name.replace(/[^A-Za-z0-9_.-]/g, "_") || fallback;
    const path = join(dir, `#${seq}-${safe}`);
    writeFileSync(path, item.bytes, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Written with mode 0600 already; a mode this user can't set must not fail saving it.
    }
    return path;
  });
}
