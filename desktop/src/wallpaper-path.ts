import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { childEnv } from "./child-env.ts";

export function pathOfUri(uri: string): string | null {
  const s = uri.trim().replace(/^'(.*)'$/, "$1");
  if (s.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(s).pathname);
    } catch {
      // A malformed URI names no wallpaper we can read.
      return null;
    }
  }
  return s.startsWith("/") ? s : null;
}

export function kdeWallpaper(appletsrc: string): string | null {
  let inImage = false;
  for (const line of appletsrc.split("\n")) {
    const t = line.trim();
    if (t.startsWith("[")) inImage = t.endsWith("[Wallpaper][org.kde.image][General]");
    else if (inImage && t.startsWith("Image=")) return pathOfUri(t.slice("Image=".length));
  }
  return null;
}

function gnomeWallpaper(dark: boolean): string | null {
  for (const key of dark ? ["picture-uri-dark", "picture-uri"] : ["picture-uri"]) {
    try {
      const out = execFileSync("gsettings", ["get", "org.gnome.desktop.background", key], { encoding: "utf8", timeout: 2000, env: childEnv() });
      const p = pathOfUri(out);
      if (p) return p;
    } catch {
      // No gsettings or no GNOME schema: another desktop may still name its wallpaper.
    }
  }
  return null;
}

export function linuxWallpaper(dark: boolean): string | null {
  const kde = path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"), "plasma-org.kde.plasma.desktop-appletsrc");
  const fromKde = /kde/i.test(process.env["XDG_CURRENT_DESKTOP"] ?? "") && fs.existsSync(kde) ? kdeWallpaper(fs.readFileSync(kde, "utf8")) : null;
  const found = fromKde ?? gnomeWallpaper(dark);
  return found && fs.existsSync(found) && fs.statSync(found).isFile() ? found : null;
}
