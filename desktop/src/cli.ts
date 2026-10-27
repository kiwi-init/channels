// The kiwi CLI on the app's own computer is the app's to keep: the agents here run it, and nobody
// should have to install or update it by hand. On every start the app puts the binary it ships with
// where the install script does (~/.kiwi/bin/kiwi), whenever that one is missing or older (never a
// downgrade: a newer one someone installed stays), and makes sure a shell finds it as plain `kiwi`.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { ensureOnPath as ensureShellPath } from "@kiwi/core/node/shell-path.ts";
import { compareVersions } from "@kiwi/core/versions.ts";
import { childEnv } from "./child-env.ts";

/** Where the CLI lives: the install script's place (KIWI_INSTALL moves both). */
function cliPath(): string {
  return path.join(process.env["KIWI_INSTALL"] || path.join(os.homedir(), ".kiwi", "bin"), process.platform === "win32" ? "kiwi.exe" : "kiwi");
}

/** What a kiwi binary says it is, or null when it won't run. */
function versionOf(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 5_000, env: childEnv() }, (err, stdout) => resolve(err ? null : stdout.trim().split(/\s+/).pop() || null));
  });
}

function brewPrefixes(): string[] {
  return [...new Set([process.env["HOMEBREW_PREFIX"], "/opt/homebrew", "/home/linuxbrew/.linuxbrew"].filter((p): p is string => !!p && path.isAbsolute(p)))];
}

export function homebrewKiwi(prefixes: readonly string[]): string | null {
  for (const prefix of prefixes) {
    const bin = path.join(prefix, "bin", "kiwi");
    try {
      if (fs.realpathSync(bin).startsWith(path.join(fs.realpathSync(prefix), "Cellar", "kiwi") + path.sep)) return bin;
    } catch {
      // No kiwi from Homebrew under this prefix.
    }
  }
  return null;
}

export interface KeptCli {
  path: string;
  version: string;
  updated: boolean;
  homebrew: boolean;
}

/**
 * The CLI here at least as new as the app's: copies the bundled one into place (a new file renamed
 * over the old, so a daemon running the old one keeps running until it's restarted) when it's missing,
 * broken or older. Returns where it is and what version it is now.
 */
export async function keepCli(bundled: string, bundledVersion: string, prefixes: readonly string[] = brewPrefixes()): Promise<KeptCli> {
  const brew = homebrewKiwi(prefixes);
  const brewVersion = brew ? await versionOf(brew) : null;
  if (brew && brewVersion) return { path: brew, version: brewVersion, updated: false, homebrew: true };
  const dest = cliPath();
  const was = fs.existsSync(dest) ? await versionOf(dest) : null;
  if (was && compareVersions(was, bundledVersion) >= 0) return { path: dest, version: was, updated: false, homebrew: false };
  await place(bundled, dest);
  void tidy(dest);
  return { path: dest, version: bundledVersion, updated: true, homebrew: false };
}

const placing = new Map<string, Promise<void>>();

export function place(bundled: string, dest: string): Promise<void> {
  const busy = placing.get(dest);
  if (busy) return busy;
  const done = unpack(bundled, dest).finally(() => placing.delete(dest));
  placing.set(dest, done);
  return done;
}

const CLI_EXTERNAL = ["node-liblzma", "@mongodb-js/zstd"];

const CHILD_ENV = (): NodeJS.ProcessEnv => ({ PATH: "/usr/bin:/bin", HOME: os.homedir(), TMPDIR: os.tmpdir() });

function run(file: string, args: string[], what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 120_000, cwd: "/", env: CHILD_ENV() }, (err, _out, stderr) => (err ? reject(new Error(`${what}: ${stderr.trim() || err.message}`)) : resolve()));
  });
}

async function compile(bundle: string, out: string): Promise<void> {
  await run(
    process.execPath,
    ["build", "--compile", "--no-macros", "--no-compile-autoload-bunfig", "--no-compile-autoload-dotenv", bundle, "--outfile", out, ...CLI_EXTERNAL.flatMap((e) => ["--external", e])],
    `the kiwi CLI didn't build from ${bundle}`,
  );
  if (process.platform === "darwin") await run("/usr/bin/codesign", ["--force", "--sign", "-", out], "codesign failed");
  await run(out, ["--version"], "the kiwi CLI built from the app doesn't run");
}

async function unpack(bundled: string, dest: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.new-${process.pid}-${randomUUID()}`;
  try {
    if (bundled.endsWith(".js")) await compile(bundled, tmp);
    else if (bundled.endsWith(".zst")) await pipeline(fs.createReadStream(bundled), zlib.createZstdDecompress(), fs.createWriteStream(tmp));
    else await fs.promises.copyFile(bundled, tmp);
    if (process.platform !== "win32") await fs.promises.chmod(tmp, 0o755);
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}

function tidy(bin: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(bin, ["cleanup", "--quiet"], { timeout: 15_000, env: childEnv() }, () => resolve());
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
