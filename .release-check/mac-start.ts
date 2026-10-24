import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { homeKeychain } from "../../desktop/scripts/eb-home-keychain.ts";

const app = process.argv[2] ?? "";
if (!app.endsWith(".app") || !existsSync(app)) throw new Error("usage: bun mac-start.ts <Channels.app>");
const contents = join(app, "Contents");
const plist = (key: string): string => spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(contents, "Info.plist")], { encoding: "utf8" }).stdout.trim();
const pids = (pattern: string): number[] =>
  spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean)
    .map(Number);
const later = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const problems: string[] = [];
const work = mkdtempSync(join(tmpdir(), "kiwi-mac-start-"));
const home = join(work, "home");
const drop = homeKeychain(home);

const lister = join(work, "windows.swift");
writeFileSync(
  lister,
  [
    "import CoreGraphics",
    "let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []",
    "for w in list {",
    '  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]',
    '  print("\\(w[kCGWindowOwnerPID as String] as? Int ?? 0)\\t\\(w[kCGWindowLayer as String] as? Int ?? 0)\\t\\(w[kCGWindowIsOnscreen as String] as? Bool ?? false)\\t\\(Int(b["Width"] as? Double ?? 0))x\\(Int(b["Height"] as? Double ?? 0))\\t\\(w[kCGWindowOwnerName as String] as? String ?? "")")',
    "}",
  ].join("\n"),
);
type Win = { pid: number; layer: number; onscreen: boolean; size: string; owner: string };
const windows = (): Win[] =>
  spawnSync("swift", [lister], { encoding: "utf8", timeout: 120_000 })
    .stdout.split("\n")
    .filter(Boolean)
    .map((l) => {
      const [pid, layer, onscreen, size, owner] = l.split("\t");
      return { pid: Number(pid), layer: Number(layer), onscreen: onscreen === "true", size: size ?? "", owner: owner ?? "" };
    });

function found(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? found(p, name) : n === name ? [p] : [];
  });
}

windows();
const webBefore = new Set(pids("com.apple.WebKit.WebContent"));
const out = openSync(join(work, "app.log"), "w");
const exe = join(contents, "MacOS", plist("CFBundleExecutable"));
const child = spawn(exe, [], { env: { ...process.env, HOME: home }, stdio: ["ignore", out, out], detached: true });
console.log(`started ${plist("CFBundleIdentifier")} ${plist("CFBundleShortVersionString")} from ${exe} (pid ${child.pid}), HOME ${home} with a keychain of its own`);

let bun: number[] = [];
for (const end = Date.now() + 60_000; Date.now() < end && !bun.length; await later(500)) bun = pids(join(contents, "MacOS", "bun"));
if (!bun.length) problems.push("the app's bun process didn't start within 60 s");

let mine: Win[] = [];
for (const end = Date.now() + 60_000; Date.now() < end && !mine.length; await later(2_000)) {
  const ours = new Set(pids(contents));
  mine = windows().filter((w) => ours.has(w.pid) && w.layer === 0 && w.onscreen);
}
if (mine.length) console.log(`window: ${mine.map((w) => `${w.owner} (pid ${w.pid}) ${w.size} on screen`).join("; ")}`);
else problems.push(`no on-screen window of the app's own within 60 s (its processes: ${pids(contents).join(", ") || "none"})`);

const web = pids("com.apple.WebKit.WebContent").filter((p) => !webBefore.has(p));
if (web.length) console.log(`web content: ${web.length} new WebContent process${web.length > 1 ? "es" : ""} (${web.join(", ")})`);
else problems.push("no new WebKit WebContent process: the page didn't load");

await later(5_000);
if (child.exitCode !== null) problems.push(`the app exited (${child.exitCode}) while its window should be up`);
const logs = found(join(home, "Library", "Logs"), "main.log");
for (const f of logs) {
  const text = readFileSync(f, "utf8").trim();
  console.log(`main.log (${f.slice(home.length)}): ${text ? text.split("\n").slice(-8).join(" | ") : "empty"}`);
}
if (!logs.length) console.log("main.log: none written (nothing went wrong enough to log)");

if (child.pid) process.kill(-child.pid, "SIGTERM");
for (const end = Date.now() + 15_000; Date.now() < end && pids(contents).length; await later(500)) {}
const left = pids(contents);
if (left.length) {
  problems.push(`still running 15 s after SIGTERM: ${left.join(", ")}`);
  for (const p of left) process.kill(p, "SIGKILL");
} else console.log("stopped: nothing of the app left 15 s after SIGTERM");
drop();
console.log(`app output (last lines): ${readFileSync(join(work, "app.log"), "utf8").trim().split("\n").slice(-6).join(" | ")}`);
for (const p of problems) console.error(`mac-start: ${p}`);
process.exit(problems.length ? 1 : 0);
