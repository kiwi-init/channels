import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { compareVersions } from "@kiwi/core/versions.ts";
import desktopPackage from "../package.json" with { type: "json" };
import { signedLikeThisApp } from "../src/signer.ts";
import { swapAsset, swapScript } from "../src/update-asset.ts";
import { homeKeychain, stuck } from "./eb-home-keychain.ts";

const [oldZip, newZip] = process.argv.slice(2);
if (!oldZip || !newZip) throw new Error("usage: bun desktop/scripts/eb-update-rehearsal.ts <an older Channels-…-mac-arm64.zip> <new Channels-…-mac-arm64.zip>");
const signed = process.env.EB_SIGNED === "1";
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function must(cmd: string, args: string[], what: string): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`update rehearsal: ${what} failed (${cmd} exited ${String(r.status)})\n${r.stdout ?? ""}${r.stderr ?? ""}`);
  return r.stdout ?? "";
}

const plist = (app: string, key: string): string => must("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(app, "Contents", "Info.plist")], `reading ${key}`).trim();

async function until<T>(what: string, ms: number, probe: () => T | null): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = probe();
    if (got !== null) return got;
    if (Date.now() > end) throw new Error(`update rehearsal: ${what}: nothing after ${ms / 1000}s`);
    await later(100);
  }
}

function windowOf(pids: number[]): string | null {
  const script = `ObjC.import("CoreGraphics"); const pids = ${JSON.stringify(pids)}; const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0))); JSON.stringify(list.filter((w) => pids.includes(w.kCGWindowOwnerPID) && w.kCGWindowName === "Channels" && w.kCGWindowIsOnscreen).map((w) => w.kCGWindowNumber))`;
  const r = spawnSync("osascript", ["-l", "JavaScript", "-e", script], { encoding: "utf8" });
  const ids = r.status === 0 ? (JSON.parse(r.stdout) as unknown) : [];
  return Array.isArray(ids) && ids.length ? String(ids[0]) : null;
}

function tree(root: number): number[] {
  const out = [root];
  for (let i = 0; i < out.length; i++) {
    const kids = spawnSync("pgrep", ["-P", String(out[i])], { encoding: "utf8" })
      .stdout.split("\n")
      .filter(Boolean)
      .map(Number);
    out.push(...kids);
  }
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-update-rehearsal-"));
let app: ReturnType<typeof spawn> | null = null;
let dropKeychain: () => void = () => {};
try {
  const apps = path.join(tmp, "Applications");
  fs.mkdirSync(apps);
  must("ditto", ["-x", "-k", oldZip, apps], "installing the older app");
  const target = path.join(apps, "Channels.app");
  const from = plist(target, "CFBundleShortVersionString");
  const to = desktopPackage.version;
  console.log(`the installed app: ${from}; the update: ${to}`);
  if (compareVersions(to, from) <= 0) throw new Error(`update rehearsal: the updater only takes a newer release, and ${to} isn't newer than ${from}`);

  const name = swapAsset(to, "darwin", "arm64");
  if (path.basename(newZip) !== name) throw new Error(`update rehearsal: the updater asks for ${String(name)}, and the release has ${path.basename(newZip)}`);
  const sums = `${createHash("sha256").update(fs.readFileSync(newZip)).digest("hex")}  ${name}\n`;
  const stage = fs.mkdtempSync(path.join(tmp, "kiwi-update-"));
  const download = path.join(stage, name);
  fs.copyFileSync(newZip, download);
  const want = sums
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find(([, f]) => f === name)?.[0];
  if (want !== createHash("sha256").update(fs.readFileSync(download)).digest("hex")) throw new Error("update rehearsal: the download doesn't match its SHA256SUMS line");
  must("ditto", ["-x", "-k", download, stage], "unpacking the update as the updater does");
  const next = path.join(stage, "Channels.app");
  if (!fs.existsSync(next)) throw new Error(`update rehearsal: ${name} has no Channels.app at its root`);
  if (signed) {
    if (!(await signedLikeThisApp(target, next)))
      throw new Error("update rehearsal: the installed app's updater would refuse it: not signed like the installed app (codesign -R its designated requirement, then spctl)");
    console.log("signed like the installed app: its designated requirement and Gatekeeper accept the update");
  } else console.log("rehearsal without the Developer ID: the signature check is skipped");

  const waiting = spawn("sleep", ["60"], { stdio: "ignore" });
  const marker = path.join(tmp, "update-failed");
  const script = path.join(stage, "swap.sh");
  fs.writeFileSync(script, swapScript({ pid: waiting.pid ?? 0, target, next, dir: stage, marker, version: to, relaunch: false }));
  const swap = spawn("/bin/sh", [script], { stdio: "ignore" });
  const swapped = new Promise<number | null>((r) => swap.on("exit", r));
  waiting.kill();
  if ((await swapped) !== 0) throw new Error("update rehearsal: the swap script failed");
  if (fs.existsSync(marker)) throw new Error(`update rehearsal: the swap left its failure marker: ${fs.readFileSync(marker, "utf8")}`);
  if (fs.existsSync(stage)) throw new Error("update rehearsal: the swap left the download behind");
  if (fs.readdirSync(apps).some((n) => n.startsWith("Channels.app.old-"))) throw new Error("update rehearsal: the old app is still beside the new one");
  if (plist(target, "CFBundleIdentifier") !== "com.kiwiinit.channels") throw new Error("update rehearsal: the swapped app isn't com.kiwiinit.channels");
  const now = (JSON.parse(fs.readFileSync(path.join(target, "Contents", "Resources", "version.json"), "utf8")) as { version?: unknown }).version;
  if (now !== to) throw new Error(`update rehearsal: ${target} is ${String(now)} after the swap, not ${to}`);
  console.log(`swapped in place: ${target} is Channels ${to} on Electrobun`);

  const home = path.join(tmp, "home");
  fs.mkdirSync(home);
  dropKeychain = homeKeychain(home);
  app = spawn(path.join(target, "Contents", "MacOS", plist(target, "CFBundleExecutable")), [], { stdio: "ignore", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: tmp } });
  const started = Date.now();
  const launched = app.pid ?? 0;
  const win = await until("the updated app's window", 30_000, () => windowOf(tree(launched))).catch((e: unknown) => {
    for (const pid of tree(launched)) console.error(`update rehearsal: where it waits:\n${stuck(pid)}`);
    throw e;
  });
  console.log(`the updated app opened its window (${win}) ${Date.now() - started} ms after launch`);
} finally {
  if (app?.pid) for (const pid of tree(app.pid).reverse()) spawnSync("kill", ["-9", String(pid)]);
  dropKeychain();
  fs.rmSync(tmp, { recursive: true, force: true });
}
