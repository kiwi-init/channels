import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { plainApp } from "./eb-plain.ts";

const IN_CODE = ["kiwiDriver", "KIWI_EB_DRIVER", "KIWI_EB_RELAY"];
const IN_LAUNCHER = ["KIWI_EB_DRIVER", "KIWI_EB_RELAY", "CFFIXED_USER_HOME"];
const READ_PROOF = "kiwi_deny_permissions";

const releaseDir = resolve(process.argv[2] ?? "desktop/release-eb");
const testDir = resolve(process.argv[3] ?? "desktop/release-eb-test");
const tmp = mkdtempSync(join(tmpdir(), "eb-driver-check-"));

function scripts(path: string, views: boolean): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap((n) => (n === "views" && !views ? [] : scripts(join(path, n), views)));
  return /\.(c|m)?js$/.test(path) ? [path] : [];
}

const read = (files: string[]) => files.map((f) => readFileSync(f, "utf8")).join("\n");

function marks(app: string): { main: string; code: string[]; views: string[]; launcher: string[] } {
  const main = join(app, "Contents", "Resources", "app", "bun", "index.js");
  const code = read(scripts(join(app, "Contents", "Resources"), false));
  const views = read(scripts(join(app, "Contents", "Resources", "app", "views"), true));
  const exe = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
  const launcher = readFileSync(join(app, "Contents", "MacOS", exe)).toString("latin1");
  return {
    main: existsSync(main) && readFileSync(main, "utf8").includes(READ_PROOF) ? "read" : "missing",
    code: IN_CODE.filter((m) => code.includes(m)),
    views: IN_CODE.filter((m) => views.includes(m)),
    launcher: IN_LAUNCHER.filter((m) => launcher.includes(m)),
  };
}

function unpack(dir: string, name: string): string {
  const into = join(tmp, name);
  mkdirSync(into);
  return plainApp(dir, into);
}

let bad = 0;
const fail = (why: string) => {
  console.error(`eb-driver-check: ${why}`);
  bad++;
};
try {
  const release = marks(unpack(releaseDir, "release"));
  const test = marks(unpack(testDir, "test"));
  for (const [name, m] of [
    ["release", release],
    ["test", test],
  ] as const)
    if (m.main !== "read") fail(`the ${name} build's main bundle (Contents/Resources/app/bun/index.js) wasn't there or lacks ${READ_PROOF}, so nothing proves this check read the code that runs`);
  const shipped = [...release.code, ...release.views.map((m) => `${m} in its web views`), ...release.launcher.map((m) => `${m} through its launcher`)];
  if (shipped.length) fail(`the release build carries test-only code: ${shipped.join(", ")}`);
  else if (release.main === "read") console.log("release build: its main bundle read, no test driver, no relay override, none in its web views, and its launcher lets none of their variables through");
  const missing = [...IN_CODE.filter((m) => !test.code.includes(m)), ...IN_LAUNCHER.filter((m) => !test.launcher.includes(m)).map((m) => `${m} through its launcher`)];
  if (missing.length) fail(`the test build lacks ${missing.join(", ")}, so this check can't tell a release build from it`);
  else if (test.main === "read") console.log("test build: its main bundle read, the driver, the relay override and their variables through the launcher are in");
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
