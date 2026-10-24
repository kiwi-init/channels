import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { homeKeychain } from "../../desktop/scripts/eb-home-keychain.ts";

const app = process.argv[2] ?? "";
if (!app.endsWith(".app") || !existsSync(app)) throw new Error("usage: bun mac-audit.ts <Channels.app>");
const contents = join(app, "Contents");
const later = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const pids = (pattern: string): number[] =>
  spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean)
    .map(Number);
const work = mkdtempSync(join(tmpdir(), "kiwi-mac-audit-"));
const home = join(work, "home");
const drop = homeKeychain(home);
const osa = (script: string): { out: string; err: string } => {
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 60_000 });
  return { out: r.stdout.trim(), err: r.stderr.trim() };
};
const lister = join(work, "windows.swift");
writeFileSync(
  lister,
  [
    "import CoreGraphics",
    "let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []",
    "for w in list {",
    '  let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]',
    '  print("\\(w[kCGWindowOwnerPID as String] as? Int ?? 0)\\t\\(w[kCGWindowLayer as String] as? Int ?? 0)\\t\\(Int(b["Width"] as? Double ?? 0))x\\(Int(b["Height"] as? Double ?? 0))")',
    "}",
  ].join("\n"),
);
spawnSync("swift", [lister], { encoding: "utf8", timeout: 180_000 });
const shown = (): string[] => {
  const ours = new Set(pids(contents));
  return spawnSync("swift", [lister], { encoding: "utf8", timeout: 120_000 })
    .stdout.split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter(([pid, layer]) => ours.has(Number(pid)) && layer === "0")
    .map(([, , size]) => size ?? "");
};
const report: Record<string, unknown> = {};
const say = (what: string, value: unknown) => {
  report[what] = value;
  console.log(`${what}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
};
const proc = 'first process whose bundle identifier is "com.kiwiinit.channels"';
const front = () => osa(`tell application "System Events" to set frontmost of (${proc}) to true`);
const keystroke = (key: string, mods: string) => {
  front();
  return osa(`tell application "System Events" to keystroke "${key}" using {${mods}}`);
};

const out = openSync(join(work, "app.log"), "w");
const exe = join(contents, "MacOS", "kiwi-launcher");
const child = spawn(exe, [], { env: { ...process.env, HOME: home }, stdio: ["ignore", out, out], detached: true });
let windows: string[] = [];
for (const end = Date.now() + 90_000; Date.now() < end && !windows.length; await later(2_000)) windows = shown();
say("started, on-screen windows", windows);
await later(4_000);

const menus = osa(`tell application "System Events"
  set p to ${proc}
  set out to ""
  repeat with mbi in menu bar items of menu bar 1 of p
    set mname to name of mbi
    try
      repeat with mi in menu items of menu 1 of mbi
        set n to name of mi
        if n is missing value then set n to "-"
        set c to ""
        try
          set c to value of attribute "AXMenuItemCmdChar" of mi
        end try
        if c is missing value then set c to ""
        set m to ""
        try
          set m to (value of attribute "AXMenuItemCmdModifiers" of mi) as text
        end try
        set out to out & mname & " > " & n & " = " & c & " (mods " & m & ")" & linefeed
      end repeat
    end try
  end repeat
  return out
end tell`);
console.log(`menus (AXMenuItemCmdModifiers: 0 is Command alone, 1 adds Shift, 2 Option, 4 Control, 8 no Command):\n${menus.out || menus.err}`);
report["menus"] = menus.out || menus.err;

const before = shown().length;
say("Command-W keystroke", keystroke("w", "command down").err || "sent");
await later(2_000);
say("windows after Command-W", { before, after: shown() });

say("Command-M keystroke", keystroke("m", "command down").err || "sent");
await later(2_000);
say("windows after Command-M", shown());

const close = osa(`tell application "System Events" to click (first button of window 1 of (${proc}) whose subrole is "AXCloseButton")`);
await later(2_000);
say("close button clicked", { err: close.err, windows: shown(), running: pids(contents).length > 0 });
spawnSync("open", [app]);
await later(4_000);
say("windows after opening the app again (Dock reopen)", shown());

osa(`tell application "System Events" to click (first button of window 1 of (${proc}) whose subrole is "AXCloseButton")`);
await later(2_000);
const link = spawnSync("open", ["kiwi://join/audit-link"], { encoding: "utf8" });
await later(4_000);
say("windows after open kiwi://join/audit-link with the window closed", { err: link.stderr.trim(), windows: shown() });

say("Command-Q keystroke", keystroke("q", "command down").err || "sent");
await later(6_000);
say("app running after Command-Q", pids(contents).length > 0);

if (child.pid) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The app may already have quit on Command-Q: nothing to stop.
  }
}
for (const end = Date.now() + 15_000; Date.now() < end && pids(contents).length; await later(500)) {}
for (const p of pids(contents)) process.kill(p, "SIGKILL");
drop();
console.log(`app output (last lines): ${readFileSync(join(work, "app.log"), "utf8").trim().split("\n").slice(-8).join(" | ")}`);
writeFileSync(join(process.env["RUNNER_TEMP"] ?? work, "mac-audit.json"), JSON.stringify(report, null, 2));
