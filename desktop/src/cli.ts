// The kiwi CLI on the app's own computer is the app's to keep: the agents here run it, and nobody
// should have to install or update it by hand. On every start the app puts the binary it ships with
// where the install script does (~/.kiwi/bin/kiwi), whenever that one is missing or older (never a
// downgrade: a newer one someone installed stays), and makes sure a shell finds it as plain `kiwi`.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureOnPath as ensureShellPath } from "@kiwi/core/node/shell-path.ts";
import { compareVersions } from "@kiwi/core/versions.ts";

/** Where the CLI lives: the install script's place (KIWI_INSTALL moves both). */
function cliPath(): string {
  return path.join(process.env["KIWI_INSTALL"] || path.join(os.homedir(), ".kiwi", "bin"), process.platform === "win32" ? "kiwi.exe" : "kiwi");
}

/** What a kiwi binary says it is, or null when it won't run. */
function versionOf(bin: string): Promise<string | null> {
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
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.new-${process.pid}`;
  await fs.promises.copyFile(bundled, tmp);
  if (process.platform !== "win32") await fs.promises.chmod(tmp, 0o755);
  await fs.promises.rename(tmp, dest);
  void tidy(dest);
  return { path: dest, version: bundledVersion, updated: true };
}

function tidy(bin: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(bin, ["cleanup", "--quiet"], { timeout: 15_000 }, () => resolve());
  });
}

/**
 * A shell finds `kiwi`: unless the shell's own profile already names the CLI's folder (the app, the
 * install script or the person put it there), one marked line is added to it, once. Returns the file
 * it changed, if any. Shared with the install script's logic and `kiwi setup` (src/shell-path.ts).
 */
export function ensureOnPath(): string | null {
  return ensureShellPath({ dir: path.dirname(cliPath()), mark: "# Added by the Channels app: it keeps the kiwi CLI in ~/.kiwi/bin current." });
}
