import { execFile } from "node:child_process";
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

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) => execFile(cmd, args, { encoding: "utf8", timeout: 2000, env: childEnv() }, (err, stdout) => resolve(err ? "" : stdout)));

async function gnomeWallpaper(dark: boolean): Promise<string | null> {
  for (const key of dark ? ["picture-uri-dark", "picture-uri"] : ["picture-uri"]) {
    const p = pathOfUri(await run("gsettings", ["get", "org.gnome.desktop.background", key]));
    if (p) return p;
  }
  return null;
}

export function swaybgImage(argv: readonly string[]): string | null {
  if (!/(^|\/)swaybg$/.test(argv[0] ?? "")) return null;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if ((a === "-i" || a === "--image") && argv[i + 1]) return argv[i + 1] ?? null;
    if (a.startsWith("--image=")) return a.slice("--image=".length);
  }
  return null;
}

export function hyprpaperActive(out: string): string | null {
  for (const line of out.split("\n")) {
    const m = /^\s*\S*\s*=\s*(\/.+?)\s*$/.exec(line);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function swwwImage(out: string): string | null {
  return /image:\s*(\/.+?)\s*$/m.exec(out)?.[1] ?? null;
}

function processIds(): string[] {
  try {
    return fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    // No /proc to read: no swaybg to find.
    return [];
  }
}

function swaybgRunning(): string | null {
  const pids = processIds();
  for (const pid of pids) {
    try {
      const found = swaybgImage(fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean));
      if (found) return found;
    } catch {
      // The process ended or isn't ours to read: look at the next one.
    }
  }
  return null;
}

async function wlrootsWallpaper(): Promise<string | null> {
  const omarchy = path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"), "omarchy", "current", "background");
  if (fs.existsSync(omarchy)) return fs.realpathSync(omarchy);
  return swaybgRunning() ?? hyprpaperActive(await run("hyprctl", ["hyprpaper", "listactive"])) ?? swwwImage(await run("swww", ["query"]));
}

export async function linuxWallpaper(dark: boolean): Promise<string | null> {
  const desktop = process.env["XDG_CURRENT_DESKTOP"] ?? "";
  const kde = path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"), "plasma-org.kde.plasma.desktop-appletsrc");
  const fromKde = /kde/i.test(desktop) && fs.existsSync(kde) ? kdeWallpaper(fs.readFileSync(kde, "utf8")) : null;
  const fromWlroots = !fromKde && !/gnome|kde/i.test(desktop) ? await wlrootsWallpaper() : null;
  const found = fromKde ?? fromWlroots ?? (await gnomeWallpaper(dark));
  return found && fs.existsSync(found) && fs.statSync(found).isFile() ? found : null;
}
