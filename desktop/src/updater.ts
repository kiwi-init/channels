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

import { compareVersions } from "./cli.ts";
import { moveOver } from "./move.ts";
import { signedLikeThisApp } from "./signer.ts";
import { swapAsset } from "./update-asset.ts";

const REPO = "ojowwalker77/channels";
const EVERY_MS = 6 * 3_600_000;

export interface UpdateState {
  /** The newer release's version. */
  version: string;
  /** downloading, ready to restart into, or only available (a .deb: install it from the release). */
  state: "downloading" | "ready" | "available";
  url: string;
}

let staged: { version: string; path: string } | null = null;
let current: UpdateState | null = null;
let notify: (s: UpdateState) => void = () => {};

/** The Channels.app this runs from (…/Channels.app/Contents/MacOS/Channels). */
const macBundle = () => path.resolve(app.getPath("exe"), "..", "..", "..");

async function check(): Promise<void> {
  if (staged) return;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "channels-desktop" } });
  if (!res.ok) return;
  const rel = (await res.json()) as { tag_name?: string; html_url?: string; prerelease?: boolean; draft?: boolean; assets?: { name: string; browser_download_url: string }[] };
  const version = rel.tag_name?.replace(/^v/, "");
  if (!version || rel.prerelease || rel.draft || compareVersions(version, app.getVersion()) <= 0) return;
  const url = rel.html_url ?? `https://github.com/${REPO}/releases/latest`;
  const name = swapAsset(version, process.platform, process.arch);
  const asset = name ? rel.assets?.find((a) => a.name === name) : undefined;
  const sums = rel.assets?.find((a) => a.name === "SHA256SUMS");
  if (!asset || !sums) return set({ version, state: "available", url });
  set({ version, state: "downloading", url });

  // Every way out of here says ready or available, a throw included (never a "downloading" that
  // doesn't end), and one that isn't ready takes its temp dir with it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-update-"));
  try {
    const next = await download(asset.browser_download_url, sums.browser_download_url, name!, dir);
    if (next) staged = { version, path: next };
  } finally {
    if (!staged) fs.rmSync(dir, { recursive: true, force: true });
    set({ version, state: staged ? "ready" : "available", url });
  }
}

/** The release's file for this install, checked against its SHA256SUMS and unpacked in `dir`: what goes in place, or null. */
async function download(assetUrl: string, sumsUrl: string, name: string, dir: string): Promise<string | null> {
  const sums = await fetch(sumsUrl);
  if (!sums.ok) return null;
  const want = (await sums.text()).split("\n").map((l) => l.trim().split(/\s+/)).find(([, f]) => f === name)?.[0];
  if (!want) return null;
  const body = await fetch(assetUrl);
  if (!body.ok) return null;
  const bytes = Buffer.from(await body.arrayBuffer());
  // Nothing goes in place unless it is exactly the file the release lists.
  if (createHash("sha256").update(bytes).digest("hex") !== want) return null;
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  if (process.platform === "darwin") {
    // ditto keeps the bundle's symlinks and modes (the frameworks need both).
    await run("/usr/bin/ditto", ["-x", "-k", file, dir]);
    const next = path.join(dir, "Channels.app");
    return fs.existsSync(next) && (await signedLikeThisApp(macBundle(), next)) ? next : null;
  }
  fs.chmodSync(file, 0o755);
  return file;
}

function set(s: UpdateState): void {
  current = s;
  notify(s);
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
  const dir = path.dirname(staged.path);
  if (process.platform === "darwin") {
    const target = macBundle();
    if (!target.endsWith(".app")) return false;
    const old = `${target}.old-${process.pid}`;
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const script = path.join(dir, "swap.sh");
    fs.writeFileSync(
      script,
      [
        "#!/bin/sh",
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
        `mv ${q(target)} ${q(old)} && mv ${q(staged.path)} ${q(target)} && rm -rf ${q(old)} || { [ -e ${q(target)} ] || mv ${q(old)} ${q(target)}; }`,
        // Relaunch before the cleanup: the cleanup removes this script's own folder.
        relaunch ? `open ${q(target)}` : "",
        `rm -rf ${q(dir)}`,
      ].join("\n"),
    );
    spawn("/bin/sh", [script], { detached: true, stdio: "ignore" }).unref();
  } else {
    const target = process.env["APPIMAGE"];
    if (!target) return false;
    // The download sits in the temp dir, often on another filesystem than the AppImage (moveOver).
    try {
      moveOver(staged.path, target);
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
  const tick = () => void check().catch(() => {});
  setTimeout(tick, 20_000);
  setInterval(tick, EVERY_MS);
  // Whatever's ready goes in when the app quits on its own terms.
  app.on("will-quit", () => void applyUpdate(false));
}

export const updateState = (): UpdateState | null => current;
