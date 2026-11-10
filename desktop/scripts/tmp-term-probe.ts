import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { payloadOf, shippedApp } from "./eb-app.ts";
import { killAll } from "./eb-drive.ts";
import { homeKeychain } from "./eb-home-keychain.ts";

const given = resolve(process.argv[2] ?? "");
const tmp = mkdtempSync(join(tmpdir(), "kiwi-term-probe-"));
const app = shippedApp(payloadOf(join(given, "artifacts")), tmp);
const plist = join(app, "Contents", "Info.plist");
const exe = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", plist], { encoding: "utf8" }).trim();
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pids = () => spawnSync("pgrep", ["-f", app], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
const table = (list: number[]) =>
  list.length ? spawnSync("ps", ["-o", "pid,ppid,pgid,etime,stat,ignored,blocked,caught,command", "-www", "-p", list.join(",")], { encoding: "utf8" }).stdout.trim() : "(none)";
const compiling = () => spawnSync("pgrep", ["-f", "build --compile"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);

for (let round = 1; round <= 6; round++) {
  const home = join(tmp, `home-${round}`);
  mkdirSync(home, { recursive: true });
  const drop = homeKeychain(home);
  const child = spawn(join(app, "Contents", "MacOS", exe), [], { env: { ...process.env, HOME: home }, stdio: "ignore", detached: true });
  const began = Date.now();
  let seen: number[] = [];
  for (const end = began + 90_000; Date.now() < end && !seen.length; await later(15)) seen = compiling();
  console.log(`\nround ${round}: compile ${seen.length ? `seen ${Date.now() - began}ms after start (pid ${seen.join(",")})` : "never seen in 90s"}; launcher pid ${child.pid}`);
  console.log(table(pids()));
  const how = round % 2 ? "the launcher's group, as eb-env-check does" : "the compile's own pid";
  const sent = Date.now();
  try {
    if (round % 2) process.kill(-child.pid!, "SIGTERM");
    else if (seen[0]) process.kill(seen[0], "SIGTERM");
  } catch (e) {
    console.log(`kill failed: ${(e as Error).message}`);
  }
  console.log(`SIGTERM sent to ${how}`);
  let last = "";
  for (const end = sent + 60_000; Date.now() < end; await later(200)) {
    const now = pids();
    const line = now.join(",");
    if (line !== last) {
      console.log(`+${Date.now() - sent}ms alive: ${line || "nobody"}`);
      if (now.length) console.log(table(now));
      last = line;
    }
    if (!now.length) break;
  }
  const bin = join(home, ".kiwi", "bin");
  console.log(`~/.kiwi/bin after: ${(() => { try { return readdirSync(bin).join(", ") || "(empty)"; } catch { return "(missing)"; } })()}`);
  killAll(pids());
  await later(500);
  drop();
}
