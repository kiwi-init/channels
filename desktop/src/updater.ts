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
import type { MovedView } from "./bridge.ts";
import { childEnv } from "./child-env.ts";
import { host } from "./host.ts";
import { keepLinuxEntry } from "./linux-entry.ts";
import { moveOver } from "./move.ts";
import { logMainError } from "./main-log.ts";
import { minisignVerifies } from "./minisign.ts";
import { RELEASE_KEY } from "./release-key.ts";
import { signedLikeThisApp } from "./signer.ts";
import { appImageHome, cantSwap, displaced, githubHop, latestTag, macAppHome, ownAppImage, releaseDownload, swapAsset, swapScript, translocated } from "./update-asset.ts";

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

interface Staged {
  version: string;
  path: string;
  url: string;
  into: string;
  dir: string | null;
}

let staged: Staged | null = null;
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
const stageDir = () => path.join(host().app.path("data"), "update-staged");
const MANIFEST = "staged.json";
const SUMS = "SHA256SUMS";
const SUMS_SIGNATURE = "SHA256SUMS.minisig";
const movedMarker = () => path.join(host().app.path("data"), "update-moved");

const writableDir = (dir: string): boolean => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const canMakeIn = (dir: string): boolean => {
  for (let at = dir; ; at = path.dirname(at)) {
    try {
      return fs.statSync(at).isDirectory() && writableDir(at);
    } catch {
      // Not there yet: it would be made inside the nearest folder that is.
      if (path.dirname(at) === at) return false;
    }
  }
};

const homeDir = (): string => {
  const home = process.env["HOME"];
  return home && path.isAbsolute(home) ? home : os.homedir();
};

const macTarget = (bundle: string): string => (!displaced(bundle) && writableDir(path.dirname(bundle)) ? bundle : (macAppHome(host().app.path("applications"), homeDir(), canMakeIn) ?? bundle));

const bundleVersion = (app: string): string | null => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(app, "Contents", "Resources", "version.json"), "utf8")) as { version?: unknown };
    return typeof raw.version === "string" ? raw.version : null;
  } catch {
    // No Channels.app there, or one without its version.json: nothing to hand over to.
    return null;
  }
};

async function alreadyThere(bundle: string, home: string, version: string, url: string): Promise<UpdateState | null> {
  const there = bundleVersion(home);
  if (!there || compareVersions(there, version) < 0 || !(await signedLikeThisApp(bundle, home))) return null;
  staged = { version, path: home, url, into: home, dir: null };
  return set({ version, state: "ready", url });
}

const swapTarget = (appImage: string): string => (writableDir(path.dirname(appImage)) ? appImage : (appImageHome(homeDir(), process.env["XDG_DATA_HOME"], canMakeIn) ?? appImage));

const failedBefore = (version: string): boolean => {
  try {
    return fs.readFileSync(failedMarker(), "utf8").trim() === version;
  } catch {
    // No marker: the last swap went in, or none was tried.
    return false;
  }
};

interface Manifest {
  version: string;
  name: string;
  url: string;
  into: string;
}

const isManifest = (v: unknown): v is Manifest => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o["version"] === "string" && typeof o["name"] === "string" && typeof o["url"] === "string" && typeof o["into"] === "string";
};

const listedSum = (sums: Uint8Array, name: string): string | undefined =>
  new TextDecoder()
    .decode(sums)
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([, f]) => f === name)?.[0];

function fileSum(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function keptStage(dir: string): Promise<Staged | null> {
  const m: unknown = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
  if (!isManifest(m) || compareVersions(m.version, host().app.version()) <= 0 || failedBefore(m.version)) return null;
  const appImage = runningAppImage();
  const bundle = process.platform === "darwin" ? macBundle() : undefined;
  const target = bundle ? macTarget(bundle) : appImage ? swapTarget(appImage) : undefined;
  if (m.into !== target || m.name !== swapAsset(m.version, process.platform, process.arch, appImage) || cantSwap(target, canMakeIn, false)) return null;
  if (bundle) {
    const next = path.join(dir, "Channels.app");
    if (bundleVersion(next) !== m.version || !(await signedLikeThisApp(bundle, next))) return null;
    return { version: m.version, path: next, url: m.url, into: m.into, dir };
  }
  const sums = new Uint8Array(fs.readFileSync(path.join(dir, SUMS)));
  if (!minisignVerifies(sums, fs.readFileSync(path.join(dir, SUMS_SIGNATURE), "utf8"), RELEASE_KEY)) return null;
  const file = path.join(dir, m.name);
  const want = listedSum(sums, m.name);
  if (!want || (await fileSum(file)) !== want) return null;
  return { version: m.version, path: file, url: m.url, into: m.into, dir };
}

let adopted: Promise<void> | null = null;

async function adoptStage(): Promise<void> {
  const dir = stageDir();
  if (!fs.existsSync(dir)) return;
  const kept = await keptStage(dir).catch(() => null);
  if (staged || fetching) return;
  if (!kept) return fs.rmSync(dir, { recursive: true, force: true });
  staged = kept;
  set({ version: kept.version, state: "ready", url: kept.url });
  console.log(`Channels: the update to ${kept.version} downloaded before is still good, so it isn't downloaded again`);
}

async function check(): Promise<UpdateCheck> {
  if (fetching && current) return current;
  await (adopted ??= adoptStage());
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
    if (staged.dir) fs.rmSync(staged.dir, { recursive: true, force: true });
    staged = null;
  }
  const appImage = runningAppImage();
  const packaged = host().app.packaged();
  const name = packaged ? swapAsset(version, process.platform, process.arch, appImage) : null;
  const fileOf = (n: string | null) => (n ? releaseDownload(REPO, tag, n) : null);
  const asset = fileOf(name);
  const sums = fileOf("SHA256SUMS");
  const signature = process.platform === "darwin" ? null : fileOf("SHA256SUMS.minisig");
  const bundle = process.platform === "darwin" ? macBundle() : undefined;
  const target = bundle ? macTarget(bundle) : appImage ? swapTarget(appImage) : undefined;
  if (name && target && cantSwap(target, canMakeIn, failedBefore(version))) return set({ version, state: "available", url, blocked: true });
  if (name && bundle && target && target !== bundle) {
    const handed = await alreadyThere(bundle, target, version, url);
    if (handed) return handed;
  }
  if (!asset || !sums || !target || (process.platform !== "darwin" && !signature)) return set({ version, state: "available", url });
  const shown = set({ version, state: "downloading", url });
  fetching = fetchUpdate(version, url, target, asset, sums, signature, name!).finally(() => (fetching = null));
  return shown;
}

async function fetchUpdate(version: string, url: string, into: string, assetUrl: string, sumsUrl: string, signatureUrl: string | null, name: string): Promise<void> {
  let dir: string | null = null;
  try {
    fs.rmSync(stageDir(), { recursive: true, force: true });
    fs.mkdirSync(stageDir(), { recursive: true });
    dir = stageDir();
    let shown = 0;
    const onBytes = (got: number, total: number) => {
      const progress = Math.min(99, Math.floor((got / total) * 100));
      if (progress <= shown) return;
      shown = progress;
      set({ version, state: "downloading", url, progress: progress / 100 });
    };
    const next = await download(assetUrl, sumsUrl, signatureUrl, name, dir, onBytes);
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ version, name, url, into } satisfies Manifest));
    staged = { version, path: next, url, into, dir };
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

async function signedSums(sums: Uint8Array, signatureUrl: string, dir: string): Promise<void> {
  const signature = await githubFetch(signatureUrl, AbortSignal.timeout(ASK_WAIT_MS));
  if (!signature.ok) throw new Error(`SHA256SUMS.minisig answered ${signature.status}`);
  const text = await signature.text();
  if (!minisignVerifies(sums, text, RELEASE_KEY)) throw new Error("SHA256SUMS isn't signed with the Channels release key");
  fs.writeFileSync(path.join(dir, SUMS), sums);
  fs.writeFileSync(path.join(dir, SUMS_SIGNATURE), text);
}

/** The release's file for this install, checked against its SHA256SUMS (signed, when a signature is asked for) and unpacked in `dir`: what goes in place, or null. */
async function download(assetUrl: string, sumsUrl: string, signatureUrl: string | null, name: string, dir: string, onBytes: (got: number, total: number) => void): Promise<string> {
  const sums = await githubFetch(sumsUrl, AbortSignal.timeout(ASK_WAIT_MS));
  if (!sums.ok) throw new Error(`SHA256SUMS answered ${sums.status}`);
  const listed = new Uint8Array(await sums.arrayBuffer());
  if (signatureUrl) await signedSums(listed, signatureUrl, dir);
  const want = listedSum(listed, name);
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

function swapIn(next: Staged, relaunch: boolean): boolean {
  if (process.platform === "darwin") {
    const from = macBundle();
    if (!from.endsWith(".app") || !next.into.endsWith(".app")) return false;
    if (!next.dir) {
      if (!relaunch) return false;
      host().app.relaunch(next.into);
      staged = null;
      return true;
    }
    const moved = realOr(next.into) !== realOr(from) ? { marker: movedMarker(), text: JSON.stringify({ from: translocated(from) ? null : from, to: next.into }) } : undefined;
    const script = path.join(next.dir, "swap.sh");
    fs.writeFileSync(
      script,
      swapScript({ pid: process.pid, target: next.into, from, next: next.path, dir: next.dir, marker: failedMarker(), version: next.version, relaunch, ...(moved ? { moved } : {}) }),
    );
    spawn("/bin/sh", [script], { detached: true, stdio: "ignore", env: childEnv() }).unref();
  } else {
    const dir = next.dir;
    const running = runningAppImage();
    if (!running || !dir) return false;
    const target = next.into;
    // The download sits in the temp dir, often on another filesystem than the AppImage (moveOver).
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
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
    if (realOr(target) !== realOr(running)) movedFrom(running, target);
    if (relaunch) host().app.relaunch(target);
  }
  staged = null;
  return true;
}

function movedFrom(from: string, to: string): void {
  try {
    fs.writeFileSync(movedMarker(), JSON.stringify({ from, to }));
    const entry = keepLinuxEntry(to, host().app.identifier(), process.env, homeDir());
    if (entry.kind === "skipped") console.log(`Channels: no desktop entry written: ${entry.why}`);
  } catch (e) {
    // The update is in place either way; only the notice or the menu entry is lost, and main.log says which.
    logMainError(e);
  }
}

const tilde = (p: string): string => {
  const home = homeDir();
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
};

const isMoved = (v: unknown): v is { from: string | null; to: string } => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (typeof o["from"] === "string" || o["from"] === null) && typeof o["to"] === "string";
};

const runningApp = (): string | undefined => (process.platform === "darwin" ? macBundle() : runningAppImage());

export function movedApp(): MovedView | null {
  let saved: unknown;
  try {
    saved = JSON.parse(fs.readFileSync(movedMarker(), "utf8"));
  } catch {
    // No marker (nothing moved), or one that isn't JSON: there's nothing to tell.
    return null;
  }
  const running = runningApp();
  if (!isMoved(saved) || !running || realOr(saved.to) !== realOr(running)) return null;
  return saved.from === null ? { to: tilde(saved.to) } : { from: tilde(saved.from), to: tilde(saved.to) };
}

export const dismissMovedApp = (): void => fs.rmSync(movedMarker(), { force: true });

/** Start checking (packaged apps only): `onChange` hears each step, for the window and the tray. */
export function startUpdates(onChange: (s: UpdateState) => void): void {
  notify = onChange;
  if (!host().app.packaged()) return;
  console.log(`Channels: update checks are on, every ${EVERY_MS / 3_600_000} h`);
  const tick = () => void checkForUpdate();
  void (adopted ??= adoptStage());
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
