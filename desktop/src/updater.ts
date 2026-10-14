// Keeping the app itself current, from proper releases only: GitHub's "latest release" never names a
// pre-release, so release candidates never reach anyone who didn't download one. Checked at start and
// every few hours; a newer one is downloaded in the background, checked against the release's
// SHA256SUMS, and put in place the next time the app quits (or now, from "Restart to update").
//
// Not Electron's autoUpdater: on a Mac it only takes apps signed with an Apple Developer ID, and these
// builds are signed ad hoc. This swaps the bundle itself: the macOS zip for this Mac's architecture,
// or the Linux AppImage this runs from. A .deb install (owned by root) is told there's an update.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { app } from "electron";

import { compareVersions } from "./cli.ts";

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

/** What this install can swap itself for: the macOS zip for its CPU, or the AppImage it runs from. */
function assetFor(version: string): string | null {
  if (process.platform === "darwin") return `Kiwi-${version}-mac-${process.arch === "arm64" ? "arm64" : "x64"}.zip`;
  if (process.platform === "linux" && process.env["APPIMAGE"] && process.arch === "x64") return `Kiwi-${version}-linux-x86_64.AppImage`;
  return null;
}

/** The Kiwi.app this runs from (…/Kiwi.app/Contents/MacOS/Kiwi). */
const macBundle = () => path.resolve(app.getPath("exe"), "..", "..", "..");

async function check(): Promise<void> {
  if (staged) return;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "kiwi-desktop" } });
  if (!res.ok) return;
  const rel = (await res.json()) as { tag_name?: string; html_url?: string; prerelease?: boolean; draft?: boolean; assets?: { name: string; browser_download_url: string }[] };
  const version = rel.tag_name?.replace(/^v/, "");
  if (!version || rel.prerelease || rel.draft || compareVersions(version, app.getVersion()) <= 0) return;
  const url = rel.html_url ?? `https://github.com/${REPO}/releases/latest`;
  const name = assetFor(version);
  const asset = name ? rel.assets?.find((a) => a.name === name) : undefined;
  const sums = rel.assets?.find((a) => a.name === "SHA256SUMS");
  if (!asset || !sums) return set({ version, state: "available", url });
  set({ version, state: "downloading", url });

  const want = (await (await fetch(sums.browser_download_url)).text()).split("\n").map((l) => l.trim().split(/\s+/)).find(([, f]) => f === name)?.[0];
  if (!want) return set({ version, state: "available", url });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-update-"));
  const file = path.join(dir, name!);
  const body = await fetch(asset.browser_download_url);
  if (!body.ok || !body.body) return set({ version, state: "available", url });
  const bytes = Buffer.from(await body.arrayBuffer());
  // Nothing goes in place unless it is exactly the file the release lists.
  if (createHash("sha256").update(bytes).digest("hex") !== want) {
    fs.rmSync(dir, { recursive: true, force: true });
    return set({ version, state: "available", url });
  }
  fs.writeFileSync(file, bytes);
  if (process.platform === "darwin") {
    // ditto keeps the bundle's symlinks and modes (the frameworks need both).
    await run("/usr/bin/ditto", ["-x", "-k", file, dir]);
    const next = path.join(dir, "Kiwi.app");
    if (!fs.existsSync(next)) return set({ version, state: "available", url });
    staged = { version, path: next };
  } else {
    fs.chmodSync(file, 0o755);
    staged = { version, path: file };
  }
  set({ version, state: "ready", url });
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
 * bundle (keeping the old one until the new one is there), and opens the new one when `relaunch`;
 * an AppImage is renamed over the running one (Linux keeps the old file open) and relaunched.
 */
export function applyUpdate(relaunch: boolean): boolean {
  if (!staged) return false;
  if (process.platform === "darwin") {
    const target = macBundle();
    if (!target.endsWith(".app")) return false;
    const old = `${target}.old-${process.pid}`;
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const script = path.join(path.dirname(staged.path), "swap.sh");
    fs.writeFileSync(
      script,
      [
        "#!/bin/sh",
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done`,
        `mv ${q(target)} ${q(old)} && mv ${q(staged.path)} ${q(target)} && rm -rf ${q(old)} || { [ -e ${q(target)} ] || mv ${q(old)} ${q(target)}; }`,
        relaunch ? `open ${q(target)}` : "",
      ].join("\n"),
    );
    spawn("/bin/sh", [script], { detached: true, stdio: "ignore" }).unref();
  } else {
    const target = process.env["APPIMAGE"];
    if (!target) return false;
    fs.renameSync(staged.path, target);
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
