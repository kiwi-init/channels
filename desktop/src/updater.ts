// Keeping the app itself current, from proper releases only: GitHub's "latest release" never names a
// pre-release, so release candidates never reach anyone who didn't download one. Checked at start and
// every few hours; a newer one is downloaded in the background, checked against the release's
// SHA256SUMS (on Linux, only once SHA256SUMS.minisig verifies it with the key pinned in
// release-key.ts), and put in place the next time the app quits (or now, from "Restart to update").

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { compareVersions } from "@kiwi/core/versions.ts";
import { childEnv } from "./child-env.ts";
import { host } from "./host.ts";
import { moveOver } from "./move.ts";
import { logMainError } from "./main-log.ts";
import { minisignVerifies } from "./minisign.ts";
import { RELEASE_KEY } from "./release-key.ts";
import { signedLikeThisApp } from "./signer.ts";
import { cantSwap, githubHop, latestTag, ownAppImage, releaseDownload, swapAsset, swapScript } from "./update-asset.ts";

const REPO = "kiwi-init/channels";
const EVERY_MS = 6 * 3_600_000;
const RETRY_MS = 30 * 60_000;
const ASK_WAIT_MS = 30_000;
const IDLE_MS = 60_000;
const MAX_BYTES = 1_000_000_000;

export interface UpdateState {
  /** The newer release's version. */
  version: string;
  /** downloading, ready to restart into, or only available (install it from the release page). */
  state: "downloading" | "ready" | "available";
  url: string;
  blocked?: true;
  progress?: number;
}

export type UpdateCheck = UpdateState | { state: "current"; version: string } | { state: "failed" };

let staged: { version: string; path: string; url: string } | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let fetching: Promise<void> | null = null;

function retrySoon(why: string): void {
  logMainError(new Error(why));
  if (retry || !host().app.packaged()) return;
  retry = setTimeout(() => {
    retry = null;
    void checkForUpdate();
  }, RETRY_MS);
}
let current: UpdateState | null = null;
let notify: (s: UpdateState) => void = () => {};
let running: Promise<UpdateCheck> | null = null;

/** The Channels.app this runs from (…/Channels.app/Contents/MacOS/Channels). */
const macBundle = () => path.resolve(host().app.path("exe"), "..", "..", "..");

const realOr = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    // A path that can't be resolved is compared as given.
    return p;
  }
};

export const runningAppImage = (): string | undefined => {
  const dir = process.env["APPDIR"];
  return ownAppImage(process.env["APPIMAGE"], dir ? realOr(dir) : undefined, realOr(host().app.path("exe")));
};

async function githubFetch(url: string, signal: AbortSignal): Promise<Response> {
  let at = url;
  for (let hop = 0; hop <= 5; hop++) {
    if (!githubHop(at)) throw new Error(`${at} isn't GitHub's`);
    const res = await fetch(at, { signal, redirect: "manual" });
    const to = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!to) return res;
    at = new URL(to, at).href;
  }
  throw new Error(`${url} redirects more than 5 times`);
}

const failedMarker = () => path.join(host().app.path("data"), "update-failed");

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
  if (fetching && current) return current;
  const res = await fetch(`https://github.com/${REPO}/releases/latest`, {
    headers: { "user-agent": "channels-desktop" },
    redirect: "manual",
    signal: AbortSignal.timeout(ASK_WAIT_MS),
  });
  if (res.status < 300 || res.status >= 400) {
    retrySoon(`the update check got ${res.status} from GitHub, not the latest release's redirect`);
    return { state: "failed" };
  }
  const tag = latestTag(REPO, res.headers.get("location"));
  if (!tag) return { state: "failed" };
  const version = tag.slice(1);
  if (compareVersions(version, host().app.version()) <= 0) return { state: "current", version: host().app.version() };
  const url = `https://github.com/${REPO}/releases/tag/${tag}`;
  if (staged && compareVersions(version, staged.version) <= 0) return current ?? set({ version: staged.version, state: "ready", url: staged.url });
  if (staged) {
    fs.rmSync(path.dirname(staged.path), { recursive: true, force: true });
    staged = null;
  }
  const appImage = runningAppImage();
  const packaged = host().app.packaged();
  const name = packaged ? swapAsset(version, process.platform, process.arch, appImage) : null;
  const fileOf = (n: string | null) => (n ? releaseDownload(REPO, tag, n) : null);
  const asset = fileOf(name);
  const sums = fileOf("SHA256SUMS");
  const signature = process.platform === "darwin" ? null : fileOf("SHA256SUMS.minisig");
  const target = process.platform === "darwin" ? macBundle() : appImage;
  if (name && target && cantSwap(target, writableDir, failedBefore(version))) return set({ version, state: "available", url, blocked: true });
  if (!asset || !sums || (process.platform !== "darwin" && !signature)) return set({ version, state: "available", url });
  const shown = set({ version, state: "downloading", url });
  fetching = fetchUpdate(version, url, asset, sums, signature, name!).finally(() => (fetching = null));
  return shown;
}

async function fetchUpdate(version: string, url: string, assetUrl: string, sumsUrl: string, signatureUrl: string | null, name: string): Promise<void> {
  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-update-"));
    let shown = 0;
    const onBytes = (got: number, total: number) => {
      const progress = Math.min(99, Math.floor((got / total) * 100));
      if (progress <= shown) return;
      shown = progress;
      set({ version, state: "downloading", url, progress: progress / 100 });
    };
    staged = { version, path: await download(assetUrl, sumsUrl, signatureUrl, name, dir, onBytes), url };
  } catch (e) {
    retrySoon(`couldn't put Channels ${version} in place: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (!staged && dir) fs.rmSync(dir, { recursive: true, force: true });
    set({ version, state: staged ? "ready" : "available", url });
  }
}

async function save(url: string, file: string, name: string, onBytes: (got: number, total: number) => void): Promise<string> {
  const ac = new AbortController();
  const quiet = () => ac.abort(new Error(`${name} sent nothing for ${IDLE_MS / 1000}s`));
  let idle = setTimeout(quiet, IDLE_MS);
  const fd = fs.openSync(file, "w");
  try {
    const res = await githubFetch(url, ac.signal);
    if (!res.ok || !res.body) throw new Error(`${name} answered ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    const hash = createHash("sha256");
    const reader = res.body.getReader();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(idle);
      idle = setTimeout(quiet, IDLE_MS);
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error(`${name} is over ${MAX_BYTES} bytes`);
      hash.update(value);
      fs.writeSync(fd, value);
      if (total > 0) onBytes(size, total);
    }
    return hash.digest("hex");
  } finally {
    clearTimeout(idle);
    fs.closeSync(fd);
  }
}

async function signedSums(sums: Uint8Array, signatureUrl: string): Promise<void> {
  const signature = await githubFetch(signatureUrl, AbortSignal.timeout(ASK_WAIT_MS));
  if (!signature.ok) throw new Error(`SHA256SUMS.minisig answered ${signature.status}`);
  if (!minisignVerifies(sums, await signature.text(), RELEASE_KEY)) throw new Error("SHA256SUMS isn't signed with the Channels release key");
}

/** The release's file for this install, checked against its SHA256SUMS (signed, when a signature is asked for) and unpacked in `dir`: what goes in place, or null. */
async function download(assetUrl: string, sumsUrl: string, signatureUrl: string | null, name: string, dir: string, onBytes: (got: number, total: number) => void): Promise<string> {
  const sums = await githubFetch(sumsUrl, AbortSignal.timeout(ASK_WAIT_MS));
  if (!sums.ok) throw new Error(`SHA256SUMS answered ${sums.status}`);
  const listed = new Uint8Array(await sums.arrayBuffer());
  if (signatureUrl) await signedSums(listed, signatureUrl);
  const want = new TextDecoder()
    .decode(listed)
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([, f]) => f === name)?.[0];
  if (!want) throw new Error(`SHA256SUMS doesn't list ${name}`);
  const file = path.join(dir, name);
  if ((await save(assetUrl, file, name, onBytes)) !== want) throw new Error(`${name} doesn't match its SHA256SUMS line`);
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
    const p = spawn(cmd, args, { stdio: "ignore", env: childEnv() });
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

function swapIn(next: { version: string; path: string; url: string }, relaunch: boolean): boolean {
  const dir = path.dirname(next.path);
  if (process.platform === "darwin") {
    const target = macBundle();
    if (!target.endsWith(".app")) return false;
    const script = path.join(dir, "swap.sh");
    fs.writeFileSync(script, swapScript({ pid: process.pid, target, next: next.path, dir, marker: failedMarker(), version: next.version, relaunch }));
    spawn("/bin/sh", [script], { detached: true, stdio: "ignore", env: childEnv() }).unref();
  } else {
    const target = runningAppImage();
    if (!target) return false;
    // The download sits in the temp dir, often on another filesystem than the AppImage (moveOver).
    try {
      moveOver(next.path, target);
    } catch (e) {
      // The AppImage stays as it was; the marker keeps the next launch from downloading this version again.
      logMainError(e);
      fs.writeFileSync(failedMarker(), next.version);
      fs.rmSync(dir, { recursive: true, force: true });
      staged = null;
      set({ version: next.version, state: "available", url: next.url, blocked: true });
      return false;
    }
    fs.rmSync(failedMarker(), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    if (relaunch) host().app.relaunch(target);
  }
  staged = null;
  return true;
}

/** Start checking (packaged apps only): `onChange` hears each step, for the window and the tray. */
export function startUpdates(onChange: (s: UpdateState) => void): void {
  notify = onChange;
  if (!host().app.packaged()) return;
  const tick = () => void checkForUpdate();
  setTimeout(tick, 20_000);
  setInterval(tick, EVERY_MS);
  // Whatever's ready goes in when the app quits on its own terms.
  host().app.onQuit(() => void applyUpdate(false));
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
