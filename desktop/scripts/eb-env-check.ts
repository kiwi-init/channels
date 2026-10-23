import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { payloadOf, shippedApp } from "./eb-app.ts";
import { sealApp } from "./eb-seal.ts";

const given = resolve(process.argv[2] ?? "");
if (!existsSync(given)) {
  console.error("usage: bun desktop/scripts/eb-env-check.ts <Channels.app, or desktop/release-eb to check the plain .app in its stable .app.tar.zst>");
  process.exit(2);
}
const tmp = mkdtempSync(join(tmpdir(), "kiwi-env-check-"));

const app = given.endsWith(".app") ? given : shippedApp(payloadOf(join(given, "artifacts")), tmp);
const plist = join(app, "Contents", "Info.plist");
const read = (key: string) => execFileSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim();
const id = read("CFBundleIdentifier");
const macos = join(app, "Contents", "MacOS");

function forgedCacheHome(target: string, bun: string): string {
  const own = join(tmp, "attacker.js");
  writeFileSync(own, `if (process.argv[2] !== "gen") require("node:fs").writeFileSync(${JSON.stringify(join(tmp, "injected-cache"))}, "ran");\n// ${"x".repeat(60_000)}\n`);
  const gen = join(tmp, "cache-gen");
  execFileSync(bun, [own, "gen"], { env: { HOME: gen, PATH: "/usr/bin:/bin" } });
  const piles = join(gen, "Library", "Caches", "bun", "@t@");
  const made = readdirSync(piles).filter((n) => n.endsWith(".pile"));
  if (made.length !== 1) throw new Error(`expected Bun to cache one entry for a 60 KB file, found ${made.length}`);
  const pile = readFileSync(join(piles, made[0]!));
  const source = readFileSync(target);
  const key = Buffer.alloc(8);
  key.writeBigUInt64LE(Bun.hash.wyhash(source, 42n));
  pile.writeBigUInt64LE(BigInt(source.length), 14);
  key.copy(pile, 22);
  const home = join(tmp, "home");
  const into = join(home, "Library", "Caches", "bun", "@t@");
  mkdirSync(into, { recursive: true });
  writeFileSync(join(into, `${key.toString("hex")}.pile`), pile);
  return home;
}
const problems: string[] = [];
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const unquote = (line: string): string => line.trim().replace(/^"|"$/g, "");

function ciKeychain(): () => void {
  const runnerTemp = process.env["RUNNER_TEMP"] ?? "";
  if (process.env["CI"] !== "true" || process.env["GITHUB_ACTIONS"] !== "true" || !isAbsolute(runnerTemp) || !existsSync(runnerTemp)) return () => {};
  const kc = join(runnerTemp, `env-check-${process.pid}.keychain-db`);
  const list = execFileSync("security", ["list-keychains", "-d", "user"], { encoding: "utf8" }).split("\n").map(unquote).filter(Boolean);
  const def = unquote(execFileSync("security", ["default-keychain", "-d", "user"], { encoding: "utf8" }));
  execFileSync("security", ["create-keychain", "-p", "", kc]);
  execFileSync("security", ["set-keychain-settings", kc]);
  execFileSync("security", ["unlock-keychain", "-p", "", kc]);
  execFileSync("security", ["list-keychains", "-d", "user", "-s", kc, ...list]);
  execFileSync("security", ["default-keychain", "-d", "user", "-s", kc]);
  return () => {
    spawnSync("security", ["list-keychains", "-d", "user", "-s", ...list], { stdio: "ignore" });
    if (def) spawnSync("security", ["default-keychain", "-d", "user", "-s", def], { stdio: "ignore" });
    spawnSync("security", ["delete-keychain", kc], { stdio: "ignore" });
  };
}

function stuck(pid: number): string {
  const ps = spawnSync("ps", ["-o", "stat=,command=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim();
  const sampled = spawnSync("sample", [String(pid), "1", "-mayDie"], { encoding: "utf8", timeout: 15_000 }).stdout;
  const frames = sampled
    .split("\n")
    .filter((l) => /^\s+[+!:|\s]*\d+ /.test(l))
    .slice(0, 25)
    .join("\n");
  return `${pid} ${ps}\n${frames}`;
}

const IMPOSED: Record<string, string> = { BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", KIWI_KEY_FD: "3" };
const KEPT = ["HOME", "USER", "LOGNAME", "TMPDIR", "PATH", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "__CF_USER_TEXT_ENCODING", "XPC_SERVICE_NAME", "XPC_FLAGS"];
const DROPPED = [
  "BUN_OPTIONS",
  "BUN_INSPECT",
  "BUN_INSPECT_CONNECT_TO",
  "BUN_CONFIG_REGISTRY",
  "NODE_OPTIONS",
  "NODE_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "JSC_useJIT",
  "JSC_dumpOptions",
  "ELECTRON_RUN_AS_NODE",
  "KIWI_HOME",
  "XDG_CACHE_HOME",
  "BUN_INSTALL",
  "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
  "KIWI_KEY_FD",
  "XPC_SOMETHING",
  "SOMETHING_ELSE",
];

function clang(out: string, source: string, args: string[]): void {
  writeFileSync(`${out}.c`, source);
  execFileSync("clang", ["-O2", ...args, "-o", out, `${out}.c`], { stdio: "inherit" });
}

const marker = join(tmp, "marker.dylib");
clang(
  marker,
  `#include <stdio.h>\n#include <stdlib.h>\nextern const char *getprogname(void);\n__attribute__((constructor)) static void mark(void) { char p[1024]; snprintf(p, sizeof p, "${tmp}/injected-%s", getprogname()); FILE *f = fopen(p, "w"); if (f) fclose(f); }\n`,
  ["-dynamiclib"],
);
const injected = () =>
  readdirSync(tmp)
    .filter((n) => n.startsWith("injected-"))
    .map((n) => n.slice("injected-".length));

const filter = join(tmp, "filter");
const mini = join(tmp, "Mini.app");
const miniMacos = join(mini, "Contents", "MacOS");
mkdirSync(miniMacos, { recursive: true });
copyFileSync(join(macos, read("CFBundleExecutable")), join(miniMacos, "kiwi-launcher"));
execFileSync("chmod", ["755", join(miniMacos, "kiwi-launcher")]);
clang(
  join(tmp, "launcher"),
  `#include <stdio.h>\nextern char **environ;\nint main(int argc, char **argv) { if (argc < 2) return 2; FILE *f = fopen(argv[1], "w"); if (!f) return 1; for (char **e = environ; *e; e++) fprintf(f, "%s\\n", *e); fclose(f); return 0; }\n`,
  [],
);
copyFileSync(join(tmp, "launcher"), join(miniMacos, "launcher"));
writeFileSync(
  join(mini, "Contents", "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>kiwi-launcher</string><key>CFBundleIdentifier</key><string>com.kiwiinit.channels.env-check</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`,
);
sealApp(mini);
const polluted: NodeJS.ProcessEnv = Object.fromEntries([...KEPT, ...DROPPED].map((n) => [n, n === "DYLD_INSERT_LIBRARIES" ? marker : `${n.toLowerCase()}-value`]));
const ran = spawnSync(join(miniMacos, "kiwi-launcher"), [filter], { env: polluted, encoding: "utf8" });
if (ran.status !== 0 || !existsSync(filter)) problems.push(`the launcher didn't start the next one (status ${ran.status}): ${ran.stderr.trim()}`);
else {
  const seen = readFileSync(filter, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(0, line.indexOf("=")));
  const imposed = Object.entries(IMPOSED).map(([n, v]) => `${n}=${v}`);
  const lines = readFileSync(filter, "utf8").split("\n").filter(Boolean);
  const leaked = seen.filter((n) => !KEPT.includes(n) && !(n in IMPOSED));
  const lost = KEPT.filter((n) => !seen.includes(n));
  const unset = imposed.filter((line) => lines.filter((l) => l.startsWith(`${line.split("=")[0]}=`)).join() !== line);
  if (leaked.length) problems.push(`the launcher passed on ${leaked.join(", ")}`);
  if (lost.length) problems.push(`the launcher dropped ${lost.join(", ")}, which the app needs`);
  if (unset.length) problems.push(`the launcher didn't set ${unset.join(", ")} (and only that) whatever the caller gave`);
  if (!leaked.length && !lost.length && !unset.length)
    console.log(`environment: passes on ${KEPT.length} names it keeps, drops ${DROPPED.length} it doesn't (BUN_*, NODE_*, DYLD_*, JSC_* and the rest) and sets ${imposed.join(", ")} itself`);
}
if (injected().includes("launcher")) problems.push("DYLD_INSERT_LIBRARIES reached the program the launcher starts");

if (id === "com.kiwiinit.channels" && !process.env.CI) {
  console.log(`not starting ${app}: it's a release build (${id}) and this isn't CI, so it would share the installed app's data; build one with CHANNELS_EB_IDENTIFIER to check it here`);
} else {
  const restoreKeychain = ciKeychain();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      restoreKeychain();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  const preload = join(tmp, "preload.js");
  writeFileSync(preload, `require("node:fs").writeFileSync(${JSON.stringify(join(tmp, "injected-preload"))}, "ran");`);
  const port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
  const home = forgedCacheHome(join(app, "Contents", "Resources", "app", "bun", "index.js"), join(macos, "bun"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    BUN_OPTIONS: `--preload=${preload}`,
    BUN_INSPECT: `127.0.0.1:${port}/kiwi`,
    NODE_OPTIONS: `--require=${preload}`,
    DYLD_INSERT_LIBRARIES: marker,
  };
  const child = spawn(join(macos, read("CFBundleExecutable")), [], { env, stdio: "ignore", detached: true });
  const bun = join(macos, "bun");
  const up = async () => {
    for (const end = Date.now() + 60_000; Date.now() < end; await later(250)) if (spawnSync("pgrep", ["-f", bun], { encoding: "utf8" }).stdout.trim()) return true;
    return false;
  };
  if (!(await up())) problems.push("the app's bun process didn't start within 60s");
  else {
    await later(6_000);
    if (injected().includes("preload")) problems.push("BUN_OPTIONS or NODE_OPTIONS ran a file of the caller's choosing in the app's main process");
    if (injected().includes("cache")) problems.push("a forged entry in Bun's transpiler cache under HOME ran in place of the app's main code");
    const listening = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim();
    if (listening) problems.push(`BUN_INSPECT opened a debugger on 127.0.0.1:${port}`);
    const reached = injected().filter((n) => n !== "kiwi-launcher" && n !== "preload" && n !== "cache");
    if (reached.length) problems.push(`DYLD_INSERT_LIBRARIES reached ${reached.join(", ")}`);
    if (!problems.length)
      console.log(
        `the running app: BUN_OPTIONS, BUN_INSPECT, NODE_OPTIONS, DYLD_INSERT_LIBRARIES and a forged transpiler cache entry under HOME reach none of its processes${injected().includes("kiwi-launcher") ? " (the unsigned launcher itself loads an inserted library: only a signed build's hardened runtime stops that)" : ""}`,
      );
  }
  try {
    process.kill(-child.pid!, "SIGTERM");
  } catch {
    // The group is gone already: the app exited on its own, which the checks above report.
  }
  await later(2_000);
  const left = spawnSync("pgrep", ["-f", app], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
  for (const pid of left) console.error(`eb-env-check: still running after SIGTERM, where it waits:\n${stuck(pid)}`);
  for (const pid of left) process.kill(pid, "SIGKILL");
  if (left.length) problems.push(`still running after the check: ${left.join(", ")}`);
  restoreKeychain();
}

rmSync(tmp, { recursive: true, force: true });
for (const p of problems) console.error(`eb-env-check: ${p}`);
process.exit(problems.length ? 1 : 0);
