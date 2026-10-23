import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { plainApp } from "./eb-plain.ts";

const given = resolve(process.argv[2] ?? "");
if (!existsSync(given)) {
  console.error("usage: bun desktop/scripts/eb-env-check.ts <Channels.app, or desktop/release-eb to check the plain .app in its stable .app.tar.zst>");
  process.exit(2);
}
const tmp = mkdtempSync(join(tmpdir(), "kiwi-env-check-"));

const app = given.endsWith(".app") ? given : plainApp(given, tmp);
const plist = join(app, "Contents", "Info.plist");
const read = (key: string) => execFileSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim();
const id = read("CFBundleIdentifier");
const macos = join(app, "Contents", "MacOS");
const problems: string[] = [];
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
copyFileSync(join(macos, read("CFBundleExecutable")), join(tmp, "kiwi-launcher"));
execFileSync("chmod", ["755", join(tmp, "kiwi-launcher")]);
clang(
  join(tmp, "launcher"),
  `#include <stdio.h>\nextern char **environ;\nint main(int argc, char **argv) { if (argc < 2) return 2; FILE *f = fopen(argv[1], "w"); if (!f) return 1; for (char **e = environ; *e; e++) fprintf(f, "%s\\n", *e); fclose(f); return 0; }\n`,
  [],
);
const polluted: NodeJS.ProcessEnv = Object.fromEntries([...KEPT, ...DROPPED].map((n) => [n, n === "DYLD_INSERT_LIBRARIES" ? marker : `${n.toLowerCase()}-value`]));
const ran = spawnSync(join(tmp, "kiwi-launcher"), [filter], { env: polluted, encoding: "utf8" });
if (ran.status !== 0 || !existsSync(filter)) problems.push(`the launcher didn't start the next one (status ${ran.status}): ${ran.stderr.trim()}`);
else {
  const seen = readFileSync(filter, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(0, line.indexOf("=")));
  const leaked = seen.filter((n) => !KEPT.includes(n));
  const lost = KEPT.filter((n) => !seen.includes(n));
  if (leaked.length) problems.push(`the launcher passed on ${leaked.join(", ")}`);
  if (lost.length) problems.push(`the launcher dropped ${lost.join(", ")}, which the app needs`);
  if (!leaked.length && !lost.length) console.log(`environment: passes on ${KEPT.length} names it keeps, drops ${DROPPED.length} it doesn't (BUN_*, NODE_*, DYLD_*, JSC_* and the rest)`);
}
if (injected().includes("launcher")) problems.push("DYLD_INSERT_LIBRARIES reached the program the launcher starts");

if (id === "com.kiwiinit.channels" && !process.env.CI) {
  console.log(`not starting ${app}: it's a release build (${id}) and this isn't CI, so it would share the installed app's data; build one with CHANNELS_EB_IDENTIFIER to check it here`);
} else {
  const preload = join(tmp, "preload.js");
  writeFileSync(preload, `require("node:fs").writeFileSync(${JSON.stringify(join(tmp, "injected-preload"))}, "ran");`);
  const port = await new Promise<number>((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
  const env: NodeJS.ProcessEnv = { ...process.env, BUN_OPTIONS: `--preload=${preload}`, BUN_INSPECT: `127.0.0.1:${port}/kiwi`, NODE_OPTIONS: `--require=${preload}`, DYLD_INSERT_LIBRARIES: marker };
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
    const listening = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim();
    if (listening) problems.push(`BUN_INSPECT opened a debugger on 127.0.0.1:${port}`);
    const reached = injected().filter((n) => n !== "kiwi-launcher" && n !== "preload");
    if (reached.length) problems.push(`DYLD_INSERT_LIBRARIES reached ${reached.join(", ")}`);
    if (!problems.length)
      console.log(
        `the running app: BUN_OPTIONS, BUN_INSPECT, NODE_OPTIONS and DYLD_INSERT_LIBRARIES reach none of its processes${injected().includes("kiwi-launcher") ? " (the unsigned launcher itself loads an inserted library: only a signed build's hardened runtime stops that)" : ""}`,
      );
  }
  try {
    process.kill(-child.pid!, "SIGTERM");
  } catch {
    // The group is gone already: the app exited on its own, which the checks above report.
  }
  await later(2_000);
  const left = spawnSync("pgrep", ["-f", app], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
  for (const pid of left) process.kill(pid, "SIGKILL");
  if (left.length) problems.push(`still running after the check: ${left.join(", ")}`);
}

rmSync(tmp, { recursive: true, force: true });
for (const p of problems) console.error(`eb-env-check: ${p}`);
process.exit(problems.length ? 1 : 0);
