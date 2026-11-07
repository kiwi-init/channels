import fs from "node:fs";
import path from "node:path";

const ICON_BYTES = 64 * 1024;

export type IconType = "image/svg+xml" | "image/png";

export type ModIconFile = { ok: true; type: IconType; bytes: Uint8Array } | { ok: false; why: string };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function svgRoot(text: string): boolean {
  let s = text.replace(/^﻿/, "");
  for (;;) {
    s = s.trimStart();
    const close = s.startsWith("<?") ? "?>" : s.startsWith("<!--") ? "-->" : /^<!doctype/i.test(s) ? ">" : null;
    if (close === null) return /^<svg[\s>/]/.test(s);
    const end = s.indexOf(close);
    if (end < 0) return false;
    s = s.slice(end + close.length);
  }
}

export function readModIcon(dir: string, icon: string): ModIconFile {
  let root: string;
  let real: string;
  try {
    root = fs.realpathSync(dir);
    real = fs.realpathSync(path.join(dir, icon));
  } catch {
    return { ok: false, why: `its icon ${icon} isn't in its folder` };
  }
  if (!real.startsWith(root + path.sep)) return { ok: false, why: `its icon ${icon} links out of its folder` };
  const st = fs.statSync(real);
  if (!st.isFile()) return { ok: false, why: `its icon ${icon} isn't a file` };
  if (st.size > ICON_BYTES) return { ok: false, why: `its icon ${icon} is over 64 KB` };
  return iconFromBytes(icon, new Uint8Array(fs.readFileSync(real)));
}

export function iconFromBytes(icon: string, bytes: Uint8Array): ModIconFile {
  if (bytes.byteLength > ICON_BYTES) return { ok: false, why: `its icon ${icon} is over 64 KB` };
  if (/\.png$/i.test(icon)) return PNG.every((b, i) => bytes[i] === b) ? { ok: true, type: "image/png", bytes } : { ok: false, why: `its icon ${icon} isn't a PNG` };
  return svgRoot(new TextDecoder().decode(bytes)) ? { ok: true, type: "image/svg+xml", bytes } : { ok: false, why: `its icon ${icon} isn't an SVG` };
}
