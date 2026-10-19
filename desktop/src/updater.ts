// Keeping the app itself current, from proper releases only: GitHub's "latest release" never names a
// pre-release, so release candidates never reach anyone who didn't download one. Checked at start and
// every few hours; a newer one is downloaded in the background, checked against the release's
// SHA256SUMS, and put in place the next time the app quits (or now, from "Restart to update").

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "electron";

import { compareVersions } from "@kiwi/core/versions.ts";
import { moveOver } from "./move.ts";
import { logMainError } from "./main-log.ts";
import { signedLikeThisApp } from "./signer.ts";
import { cantSwap, swapAsset, swapScript } from "./update-asset.ts";

const REPO = "ojowwalker77/channels";
const EVERY_MS = 6 * 3_600_000;
const RETRY_MS = 30 * 60_000;

export interface UpdateState {
  /** The newer release's version. */
  version: string;
  /** downloading, ready to restart into, or only available (a .deb: install it from the release). */
  state: "downloading" | "ready" | "available";
  url: string;
  blocked?: true;
}

export type UpdateCheck = UpdateState | { state: "current"; version: string } | { state: "failed" };

let staged: { version: string; path: string; url: string } | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

function retrySoon(why: string): void {
  logMainError(new Error(why));
  if (retry || !app.isPackaged) return;
  retry = setTimeout(() => {
    retry = null;
    void checkForUpdate();
  }, RETRY_MS);
}
let current: UpdateState | null = null;
let notify: (s: UpdateState) => void = () => {};
let running: Promise<UpdateCheck> | null = null;

/** The Channels.app this runs from (…/Channels.app/Contents/MacOS/Channels). */
const macBundle = () => path.resolve(app.getPath("exe"), "..", "..", "..");

const failedMarker = () => path.join(app.getPath("userData"), "update-failed");

const writableDir = (dir: string): boolean => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const failedBefore = (version: string): boolean => {
  try {
    return fs.readFileSync(failedMarker(), "utf8").trim() === version;
  } catch {
    // No marker: the last swap went in, or none was tried.
    return false;
  }
};

async function check(): Promise<UpdateCheck> {
  if (staged && current) return current;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "channels-desktop" } });
  if (!res.ok) {
    retrySoon(`the update check got ${res.status} from GitHub`);
    return { state: "failed" };
  }
  const rel = (await res.json()) as { tag_name?: string; html_url?: string; prerelease?: boolean; draft?: boolean; assets?: { name: string; browser_download_url: string }[] };
  const version = rel.tag_name?.replace(/^v/, "");
  if (!version) return { state: "failed" };
  if (rel.prerelease || rel.draft || compareVersions(version, app.getVersion()) <= 0) return { state: "current", version: app.getVersion() };
  const url = rel.html_url ?? `https://github.com/${REPO}/releases/latest`;
  const name = app.isPackaged ? swapAsset(version, process.platform, process.arch) : null;
  const asset = name ? rel.assets?.find((a) => a.name === name) : undefined;
  const sums = rel.assets?.find((a) => a.name === "SHA256SUMS");
  if (name && process.platform === "darwin" && cantSwap(macBundle(), writableDir, failedBefore(version))) return set({ version, state: "available", url, blocked: true });
  if (!asset || !sums) return set({ version, state: "available", url });
  set({ version, state: "downloading", url });

  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-update-"));
    staged = { version, path: await download(asset.browser_download_url, sums.browser_download_url, name!, dir), url };
  } catch (e) {
    retrySoon(`couldn't put Channels ${version} in place: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (!staged && dir) fs.rmSync(dir, { recursive: true, force: true });
    set({ version, state: staged ? "ready" : "available", url });
  }
  return current ?? { state: "failed" };
}

/** The release's file for this install, checked against its SHA256SUMS and unpacked in `dir`: what goes in place, or null. */
async function download(assetUrl: string, sumsUrl: string, name: string, dir: string): Promise<string> {
  const sums = await fetch(sumsUrl);
  if (!sums.ok) throw new Error(`SHA256SUMS answered ${sums.status}`);
  const want = (await sums.text())
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([, f]) => f === name)?.[0];
  if (!want) throw new Error(`SHA256SUMS doesn't list ${name}`);
  const body = await fetch(assetUrl);
  if (!body.ok) throw new Error(`${name} answered ${body.status}`);
  const bytes = Buffer.from(await body.arrayBuffer());
  // Nothing goes in place unless it is exactly the file the release lists.
  if (createHash("sha256").update(bytes).digest("hex") !== want) throw new Error(`${name} doesn't match its SHA256SUMS line`);
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  if (process.platform === "darwin") {
    // ditto keeps the bundle's symlinks and modes (the frameworks need both).
    await run("/usr/bin/ditto", ["-x", "-k", file, dir]);
    const next = path.join(dir, "Channels.app");
    if (!fs.existsSync(next)) throw new Error(`${name} has no Channels.app`);
    if (!(await signedLikeThisApp(macBundle(), next))) throw new Error(`${name} isn't signed like this app`);
    return next;
  }
  fs.chmodSync(file, 0o755);
  return file;
}

function set(s: UpdateState): UpdateState {
  current = s;
  notify(s);
  return s;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on("error", reject);
  });
}

/**
 * Put the staged update in place. On a Mac, a small script waits for this process to end, swaps the
 * bundle (keeping the old one until the new one is there), clears the download's temp dir, and
 * opens the new one when `relaunch`; an AppImage is moved over the running one (Linux keeps the old
 * file open) and relaunched. False when nothing went in place.
 */
export function applyUpdate(relaunch: boolean): boolean {
  if (!staged) return false;
  if (!fs.existsSync(staged.path)) {
    logMainError(new Error(`the staged Channels ${staged.version} is gone from ${staged.path}`));
    set({ version: staged.version, state: "available", url: staged.url });
    staged = null;
    return false;
  }
  try {
    return swapIn(staged, relaunch);
  } catch (e) {
    logMainError(e);
    return false;
  }
}

function swapIn(next: { version: string; path: string }, relaunch: boolean): boolean {
  const dir = path.dirname(next.path);
  if (process.platform === "darwin") {
    const target = macBundle();
    if (!target.endsWith(".app")) return false;
    const script = path.join(dir, "swap.sh");
    fs.writeFileSync(script, swapScript({ pid: process.pid, target, next: next.path, dir, marker: failedMarker(), version: next.version, relaunch }));
    spawn("/bin/sh", [script], { detached: true, stdio: "ignore" }).unref();
  } else {
    const target = process.env["APPIMAGE"];
    if (!target) return false;
    // The download sits in the temp dir, often on another filesystem than the AppImage (moveOver).
    try {
      moveOver(next.path, target);
    } catch {
      return false;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    if (relaunch) app.relaunch({ execPath: target });
  }
  staged = null;
  return true;
}

/** Start checking (packaged apps only): `onChange` hears each step, for the window and the tray. */
export function startUpdates(onChange: (s: UpdateState) => void): void {
  notify = onChange;
  if (!app.isPackaged) return;
  const tick = () => void checkForUpdate();
  setTimeout(tick, 20_000);
  setInterval(tick, EVERY_MS);
  // Whatever's ready goes in when the app quits on its own terms.
  app.on("will-quit", () => void applyUpdate(false));
}

export const updateState = (): UpdateState | null => current;

export function checkForUpdate(): Promise<UpdateCheck> {
  running ??= check()
    .catch((e: unknown): UpdateCheck => {
      retrySoon(`the update check failed: ${e instanceof Error ? e.message : String(e)}`);
      return { state: "failed" };
    })
    .finally(() => (running = null));
  return running;
}
