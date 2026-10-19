import path from "node:path";

export function swapAsset(version: string, platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "darwin") return `Channels-${version}-mac-${arch === "arm64" ? "arm64" : "x64"}.zip`;
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
