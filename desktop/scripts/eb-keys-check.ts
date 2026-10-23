import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { payloadOf, plainApp } from "./eb-app.ts";
import { PROBE_PREFIX, type ProbeReport } from "./eb-keys-probe.ts";
import { sealApp } from "./eb-seal.ts";

const release = path.resolve(process.argv[2] ?? "desktop/release-eb");
const tag = randomBytes(4).toString("hex");
const id = `com.kiwiinit.channels.keys-check-${tag}`;
const legacy = `kiwi-keys-check-${tag}`;
const legacyValue = randomBytes(16).toString("base64");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-keys-"));
const dataDir = path.join(os.homedir(), "Library", "Application Support", id);
const failures: string[] = [];

const contents = (app: string): string => path.join(app, "Contents");
const plist = (app: string): string => path.join(contents(app), "Info.plist");
const executable = (app: string): string => path.join(contents(app), "MacOS", execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", plist(app)], { encoding: "utf8" }).trim());

function copy(app: string, name: string): string {
  const to = path.join(tmp, name, path.basename(app));
  execFileSync("ditto", [app, to]);
  return to;
}

interface Run {
  status: number | null;
  stderr: string;
  report: ProbeReport | null;
}

function run(app: string): Run {
  const r = spawnSync(executable(app), [], { encoding: "utf8", timeout: 60_000, env: { ...process.env, BUN_OPTIONS: `--preload ${path.join(tmp, "nowhere.js")}` } });
  const line = r.stdout.split("\n").find((l) => l.startsWith(PROBE_PREFIX));
  return { status: r.status, stderr: r.stderr, report: line ? (JSON.parse(line.slice(PROBE_PREFIX.length)) as ProbeReport) : null };
}

function expect(what: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures.push(`${what}: ${detail}`);
}

const okOf = (r: Run, key: string): string | null | undefined => {
  const s = r.report?.[key];
  return s && "ok" in s ? s.ok : undefined;
};

const errorOf = (r: Run, key: string): string => {
  const s = r.report?.[key];
  return s && "error" in s ? s.error : "";
};

function refused(name: string, good: string, change: (app: string) => void, why: string): void {
  const app = copy(good, name);
  change(app);
  const r = run(app);
  expect(`${name}: the launcher refuses to start (${why})`, r.status !== 0 && r.report === null && r.stderr.includes(why), `status ${r.status}, stderr ${r.stderr.slice(-400)}`);
}

function keychain(args: string[]): void {
  spawnSync("security", args, { stdio: "ignore" });
}

try {
  const base = plainApp(payloadOf(path.join(release, "artifacts")), tmp);
  const probe = await Bun.build({ entrypoints: [path.join(import.meta.dirname, "eb-keys-probe.ts")], target: "bun" });
  const out = probe.outputs[0];
  if (!probe.success || !out) throw new Error(`the probe didn't bundle: ${probe.logs.join("\n")}`);
  const good = copy(base, "good");
  fs.writeFileSync(path.join(contents(good), "Resources", "main.js"), await out.text());
  const version = path.join(contents(good), "Resources", "version.json");
  fs.writeFileSync(version, JSON.stringify({ ...(JSON.parse(fs.readFileSync(version, "utf8")) as Record<string, unknown>), identifier: id }));
  execFileSync("plutil", ["-replace", "CFBundleIdentifier", "-string", id, plist(good)]);
  sealApp(good);
  execFileSync("plutil", ["-replace", "KiwiLegacyNames", "-json", JSON.stringify([legacy]), plist(good)]);
  execFileSync("security", ["add-generic-password", "-s", `${legacy} Safe Storage`, "-a", `${legacy} Key`, "-w", legacyValue, "-A"]);

  const first = run(good);
  const made = okOf(first, "set");
  expect("first start: no store key yet, one made and saved through the launcher", okOf(first, "first") === null && typeof made === "string" && okOf(first, "get") === made, JSON.stringify(first.report ?? first.stderr.slice(-400)));
  expect("a second key never replaces the first", errorOf(first, "replace").includes("never replaces"), JSON.stringify(first.report?.["replace"]));
  expect("the old app's key, read by the launcher", okOf(first, "legacy") === legacyValue, JSON.stringify(first.report?.["legacy"]));
  expect("an app name not in Info.plist's KiwiLegacyNames is refused", errorOf(first, "unlisted").includes("isn't an app whose keys"), JSON.stringify(first.report?.["unlisted"]));
  expect("an unknown request is refused", errorOf(first, "unknown").includes("doesn't know"), JSON.stringify(first.report?.["unknown"]));
  const second = run(good);
  expect("the next start gets the same key", typeof made === "string" && okOf(second, "first") === made && second.report?.["set"] === undefined, JSON.stringify(second.report ?? second.stderr.slice(-400)));

  const main = (app: string): string => path.join(contents(app), "Resources", "main.js");
  refused("main.js changed", good, (app) => fs.appendFileSync(main(app), "\n"), "Resources/main.js was changed");
  refused("a bunfig.toml beside bun", good, (app) => fs.writeFileSync(path.join(contents(app), "MacOS", "bunfig.toml"), 'preload = ["/tmp/x.js"]\n'), "MacOS/bunfig.toml isn't part of the app");
  refused("an app.asar dropped in", good, (app) => fs.writeFileSync(path.join(contents(app), "Resources", "app.asar"), ""), "Resources/app.asar isn't part of the app");
  refused("a link", good, (app) => fs.symlinkSync("/tmp", path.join(contents(app), "Resources", "link")), "Resources/link isn't a plain file or folder");
  refused("a sealed file missing", good, (app) => fs.rmSync(path.join(contents(app), "Resources", "build.json")), "of the app's files are missing");
} finally {
  keychain(["delete-generic-password", "-s", id, "-a", "store-key"]);
  keychain(["delete-generic-password", "-s", `${legacy} Safe Storage`, "-a", `${legacy} Key`]);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`eb-keys-check: ${failures.length} failed\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("eb-keys-check: the launcher holds the key and refuses a changed app");
