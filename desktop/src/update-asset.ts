import path from "node:path";

import { appImageName, type LinuxArch } from "../scripts/linux-files.ts";

const linuxArch = (arch: string): LinuxArch | null => (arch === "x64" || arch === "arm64" ? arch : null);

export function ownAppImage(image: string | undefined, appDir: string | undefined, exe: string): string | undefined {
  if (!image || !appDir || !path.isAbsolute(image) || !path.isAbsolute(appDir)) return undefined;
  return exe.startsWith(`${path.resolve(appDir)}/`) ? image : undefined;
}

const ASSET_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);

const parsed = (url: string | undefined): URL | null => {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.port && !u.username && !u.password ? u : null;
  } catch {
    // Not a URL at all: the caller treats it as missing.
    return null;
  }
};

export function latestTag(repo: string, location: string | null): string | null {
  const u = parsed(location ?? undefined);
  const prefix = `/${repo}/releases/tag/`;
  if (!u || u.hostname !== "github.com" || u.search || !u.pathname.startsWith(prefix)) return null;
  const tag = u.pathname.slice(prefix.length);
  return /^v\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(tag) ? tag : null;
}

export const releaseDownload = (repo: string, tag: string, name: string): string => `https://github.com/${repo}/releases/download/${tag}/${name}`;

export const githubHop = (url: string): boolean => {
  const u = parsed(url);
  return !!u && ASSET_HOSTS.has(u.hostname);
};

export function swapAsset(version: string, platform: NodeJS.Platform, arch: string, appImage?: string): string | null {
  if (platform === "darwin") return `Channels-${version}-mac-${arch === "arm64" ? "arm64" : "x64"}.zip`;
  const linux = linuxArch(arch);
  if (platform === "linux" && appImage && linux) return appImageName(version, linux);
  return null;
}

const HOME_APPIMAGE = "Channels.AppImage";

export function appImageHome(home: string, dataHome: string | undefined, canMakeIn: (dir: string) => boolean): string | null {
  const data = dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(home, ".local", "share");
  const dir = [path.join(home, "Applications"), path.join(data, "Channels")].find(canMakeIn);
  return dir ? path.join(dir, HOME_APPIMAGE) : null;
}

export const translocated = (bundle: string): boolean => bundle.includes("/AppTranslocation/");

export const displaced = (bundle: string): boolean => translocated(bundle) || bundle.startsWith("/Volumes/");

export function macAppHome(applications: string, home: string, canMakeIn: (dir: string) => boolean): string | null {
  const dir = [applications, path.join(home, "Applications")].find(canMakeIn);
  return dir ? path.join(dir, "Channels.app") : null;
}

export function cantSwap(bundle: string, writable: (dir: string) => boolean, failedBefore: boolean): boolean {
  return displaced(bundle) || !writable(path.dirname(bundle)) || failedBefore;
}

export interface SwapPlan {
  pid: number;
  target: string;
  next: string;
  dir: string;
  marker: string;
  version: string;
  relaunch: boolean;
  from?: string;
  moved?: { marker: string; text: string };
}

export function swapScript(o: SwapPlan): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const old = `${o.target}.old-${o.pid}`;
  const from = o.from ?? o.target;
  return [
    "#!/bin/sh",
    `while kill -0 ${o.pid} 2>/dev/null; do sleep 0.2; done`,
    `mkdir -p ${q(path.dirname(o.target))} 2>/dev/null`,
    `if [ -e ${q(o.target)} ]; then if mv ${q(o.target)} ${q(old)} && mv ${q(o.next)} ${q(o.target)}; then rm -rf ${q(old)}; ok=1; else [ -e ${q(o.target)} ] || mv ${q(old)} ${q(o.target)}; ok=0; fi; elif mv ${q(o.next)} ${q(o.target)}; then ok=1; else ok=0; fi`,
    `if [ "$ok" = 1 ]; then rm -f ${q(o.marker)};${o.moved ? ` printf '%s' ${q(o.moved.text)} > ${q(o.moved.marker)};` : ""} else printf '%s' ${q(o.version)} > ${q(o.marker)}; fi`,
    o.relaunch ? `if [ "$ok" = 1 ]; then open ${q(o.target)}; else open ${q(from)}; fi` : "",
    `rm -rf ${q(o.dir)}`,
  ].join("\n");
}

const LEFT_BEHIND = ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "LD_LIBRARY_PATH", "LD_PRELOAD"];

export function relaunchAfter(pid: number, exe: string, env: NodeJS.ProcessEnv): { args: string[]; env: NodeJS.ProcessEnv } {
  return {
    args: ["-c", `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done; ${exe.endsWith(".app") ? "exec open" : "exec"} "$0"`, exe],
    env: Object.fromEntries(Object.entries(env).filter(([k]) => !LEFT_BEHIND.includes(k))),
  };
}
