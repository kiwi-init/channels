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

export function cantSwap(bundle: string, writable: (dir: string) => boolean, failedBefore: boolean): boolean {
  return bundle.includes("/AppTranslocation/") || bundle.startsWith("/Volumes/") || !writable(path.dirname(bundle)) || failedBefore;
}

export function swapScript(o: { pid: number; target: string; next: string; dir: string; marker: string; version: string; relaunch: boolean }): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const old = `${o.target}.old-${o.pid}`;
  return [
    "#!/bin/sh",
    `while kill -0 ${o.pid} 2>/dev/null; do sleep 0.2; done`,
    `if mv ${q(o.target)} ${q(old)} && mv ${q(o.next)} ${q(o.target)}; then rm -rf ${q(old)}; rm -f ${q(o.marker)}; else [ -e ${q(o.target)} ] || mv ${q(old)} ${q(o.target)}; printf '%s' ${q(o.version)} > ${q(o.marker)}; fi`,
    o.relaunch ? `open ${q(o.target)}` : "",
    `rm -rf ${q(o.dir)}`,
  ].join("\n");
}

const LEFT_BEHIND = ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "LD_LIBRARY_PATH", "LD_PRELOAD"];

export function relaunchAfter(pid: number, exe: string, env: NodeJS.ProcessEnv): { args: string[]; env: NodeJS.ProcessEnv } {
  return {
    args: ["-c", `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done; exec "$0"`, exe],
    env: Object.fromEntries(Object.entries(env).filter(([k]) => !LEFT_BEHIND.includes(k))),
  };
}
