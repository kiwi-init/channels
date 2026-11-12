import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { payloadOf, shippedApp } from "./eb-app.ts";
import { killAll } from "./eb-drive.ts";
import { homeKeychain } from "./eb-home-keychain.ts";

const given = resolve(process.argv[2] ?? "");
if (!existsSync(given)) {
  console.error("usage: bun desktop/scripts/eb-quit-check.ts <Channels.app, or desktop/release-eb to check the plain .app in its stable .app.tar.zst>");
  process.exit(2);
}

const START_MS = 60_000;
const QUIT_MS = 30_000;
const AFTER_MS = 1_500;

const tmp = mkdtempSync(join(tmpdir(), "kiwi-quit-check-"));
const app = given.endsWith(".app") ? given : shippedApp(payloadOf(join(given, "artifacts")), tmp);
const plist = join(app, "Contents", "Info.plist");
const read = (key: string) => execFileSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim();
const id = read("CFBundleIdentifier");
const macos = join(app, "Contents", "MacOS");
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  stat: string;
  cmd: string;
}

function processes(): Proc[] {
  return spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,stat=,command=", "-www"], { encoding: "utf8" })
    .stdout.split("\n")
    .flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), stat: m[4]!, cmd: m[5]! }] : [];
    });
}

const ending = (p: Proc): boolean => p.stat.startsWith("Z") || p.stat.includes("E");
const building = (p: Proc): boolean => p.cmd.includes("/MacOS/bun build --compile");
const installing = (p: Proc): boolean => building(p) || p.cmd.includes(".new-");
const short = (p: Proc): string => `${p.pid} ${p.cmd.replaceAll(app, "<app>").slice(0, 160)}`;

function halfMade(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > 8) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      let s;
      try {
        s = statSync(p);
      } catch {
        // Gone between the listing and the stat.
        continue;
      }
      if (s.isDirectory()) walk(p, depth + 1);
      else if (name.includes(".new-")) found.push(`${p.slice(dir.length + 1)} (${(s.size / 1024 ** 2).toFixed(0)} MB)`);
    }
  };
  walk(dir, 0);
  return found;
}

interface Moment {
  name: string;
  due: (ours: Proc[], home: string, since: number | null) => boolean;
}

const MOMENTS: Moment[] = [
  { name: "as its CLI build starts", due: (ours) => ours.some(building) },
  { name: "0.3 s into its CLI build", due: (_ours, _home, since) => since !== null && Date.now() - since >= 300 },
  { name: "once the built CLI is on disk, before it is in place", due: (_ours, home) => halfMade(home).length > 0 },
];

async function quitAt(moment: Moment): Promise<string[]> {
  const problems: string[] = [];
  const home = mkdtempSync(join(tmp, "home-"));
  mkdirSync(join(home, "Library", "Application Support"), { recursive: true });
  const dropKeychain = homeKeychain(home);
  const child = spawn(join(macos, read("CFBundleExecutable")), [], { env: { ...process.env, HOME: home }, stdio: "ignore", detached: true });
  const groups = new Set<number>([child.pid!]);
  const look = (): Proc[] => {
    const all = processes();
    for (const p of all) if (p.ppid === child.pid) groups.add(p.pgid);
    return all.filter((p) => p.pid !== process.pid && !ending(p) && (groups.has(p.pgid) || p.cmd.includes(app)));
  };
  const main = (ours: Proc[]): boolean => ours.some((p) => p.cmd.includes(join(macos, "bun")) && !building(p));
  const began = Date.now();
  let buildAt: number | null = null;
  let up = false;
  let due = false;
  while (!due && Date.now() - began < START_MS) {
    const ours = look();
    up ||= main(ours);
    if (buildAt === null && ours.some(building)) buildAt = Date.now();
    due = up && moment.due(ours, home, buildAt);
    if (!due) await later(20);
  }
  if (!due) problems.push(up ? `the app never got to the moment "${moment.name}" in ${START_MS / 1000}s` : `the app's bun process didn't start within ${START_MS / 1000}s`);
  const sentAt = Date.now();
  try {
    process.kill(-child.pid!, "SIGTERM");
  } catch {
    // The group is gone already: the app exited on its own, which the problems above report.
  }
  let ours = look();
  while (main(ours) && Date.now() - sentAt < QUIT_MS) {
    await later(20);
    ours = look();
  }
  const quitIn = Date.now() - sentAt;
  if (main(ours)) problems.push(`the app's bun was still running ${(quitIn / 1000).toFixed(1)}s after SIGTERM`);
  const outlived = new Map<number, string>();
  for (const end = Date.now() + AFTER_MS; Date.now() < end; await later(20)) for (const p of look().filter(installing)) outlived.set(p.pid, short(p));
  if (outlived.size) problems.push(`part of the CLI install outlived the app: ${[...outlived.values()].join(" | ")}`);
  const files = halfMade(home);
  if (files.length) problems.push(`a half-made CLI stayed behind: ${files.join(", ")}`);
  killAll(
    processes()
      .filter((p) => p.pid !== process.pid && !ending(p) && (groups.has(p.pgid) || p.cmd.includes(app) || p.cmd.includes(home)))
      .map((p) => p.pid),
  );
  dropKeychain();
  rmSync(home, { recursive: true, force: true });
  if (!problems.length) console.log(`quit ${moment.name}: the app was gone ${(quitIn / 1000).toFixed(1)}s after SIGTERM, no part of the CLI install outlived it and no half-made file stayed`);
  return problems.map((p) => `quit ${moment.name}: ${p}`);
}

const problems: string[] = [];
if (id === "com.kiwiinit.channels" && !process.env.CI) {
  console.log(`not starting ${app}: it's a release build (${id}) and this isn't CI, so it would share the installed app's data; build one with CHANNELS_EB_IDENTIFIER to check it here`);
} else {
  for (const moment of MOMENTS) problems.push(...(await quitAt(moment)));
}

rmSync(tmp, { recursive: true, force: true });
for (const p of problems) console.error(`eb-quit-check: ${p}`);
process.exit(problems.length ? 1 : 0);
