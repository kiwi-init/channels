// The kiwi CLI on the app's own computer is the app's to keep: the agents here run it, and nobody
// should have to install or update it by hand. On every start the app puts the binary it ships with
// where the install script does (~/.kiwi/bin/kiwi), whenever that one is missing or older (never a
// downgrade: a newer one someone installed stays), and makes sure a shell finds it as plain `kiwi`.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureOnPath as ensureShellPath } from "../../src/shell-path.ts";

/** Where the CLI lives: the install script's place (KIWI_INSTALL moves both). */
export function cliPath(): string {
  return path.join(process.env["KIWI_INSTALL"] || path.join(os.homedir(), ".kiwi", "bin"), process.platform === "win32" ? "kiwi.exe" : "kiwi");
}

/** a < b: -1, equal: 0, a > b: 1. Semver, with a release ranking above its own pre-releases (0.11.0 > 0.11.0-rc.5). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre] = v.trim().replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  // rc.5 vs rc.12: compare each dotted part, numerically when both are numbers.
  const xp = x.pre.split(".");
  const yp = y.pre.split(".");
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    const p = xp[i];
    const q = yp[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const d = /^\d+$/.test(p) && /^\d+$/.test(q) ? Number(p) - Number(q) : p.localeCompare(q);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** What a kiwi binary says it is, or null when it won't run. */
export function versionOf(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 5_000 }, (err, stdout) => resolve(err ? null : stdout.trim().split(/\s+/).pop() || null));
  });
}

/**
 * The CLI here at least as new as the app's: copies the bundled one into place (a new file renamed
 * over the old, so a daemon running the old one keeps running until it's restarted) when it's missing,
 * broken or older. Returns where it is and what version it is now.
 */
export async function keepCli(bundled: string, bundledVersion: string): Promise<{ path: string; version: string; updated: boolean }> {
  const dest = cliPath();
  const was = fs.existsSync(dest) ? await versionOf(dest) : null;
  if (was && compareVersions(was, bundledVersion) >= 0) return { path: dest, version: was, updated: false };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.new-${process.pid}`;
  fs.copyFileSync(bundled, tmp);
  if (process.platform !== "win32") fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, dest);
  return { path: dest, version: bundledVersion, updated: true };
}

/**
 * A shell finds `kiwi`: unless the shell's own profile already names the CLI's folder (the app, the
 * install script or the person put it there), one marked line is added to it, once. Returns the file
 * it changed, if any. Shared with the install script's logic and `kiwi setup` (src/shell-path.ts).
 */
export function ensureOnPath(): string | null {
  return ensureShellPath({ dir: path.dirname(cliPath()), mark: "# Added by the Kiwi app: it keeps the kiwi CLI in ~/.kiwi/bin current." });
}
