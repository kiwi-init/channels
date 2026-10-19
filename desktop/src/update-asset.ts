import path from "node:path";

export function swapAsset(version: string, platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "darwin") return `Channels-${version}-mac-${arch === "arm64" ? "arm64" : "x64"}.zip`;
  return null;
}

export function swapBlocker(bundle: string, writable: (dir: string) => boolean, failedBefore: boolean): string | null {
  if (bundle.includes("/AppTranslocation/")) return "Channels is running from a quarantined copy. Move it to Applications and open it from there to update by itself.";
  if (bundle.startsWith("/Volumes/")) return "Channels is running from its disk image. Drag it to Applications and open it from there to update by itself.";
  if (!writable(path.dirname(bundle))) return `Channels can't replace itself in ${path.dirname(bundle)}. Install this one from the release.`;
  if (failedBefore) return "The last try to put this version in place didn't work. Install it from the release.";
  return null;
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
