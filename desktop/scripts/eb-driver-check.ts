import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { plainApp } from "./eb-plain.ts";

const IN_CODE = ["kiwiDriver", "KIWI_EB_DRIVER", "KIWI_EB_RELAY"];
const IN_LAUNCHER = ["KIWI_EB_DRIVER", "KIWI_EB_RELAY", "CFFIXED_USER_HOME"];

const dir = resolve(process.argv[2] ?? "desktop/release-eb");
const builds = join(dir, "build");
const tmp = mkdtempSync(join(tmpdir(), "eb-driver-check-"));

function scripts(path: string): string[] {
  const st = statSync(path);
  if (st.isDirectory()) return readdirSync(path).flatMap((n) => (n === "views" ? [] : scripts(join(path, n))));
  return /\.(c|m)?js$/.test(path) ? [path] : [];
}

function marks(app: string): { code: string[]; launcher: string[] } {
  const code = scripts(join(app, "Contents", "Resources"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const exe = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
  const launcher = readFileSync(join(app, "Contents", "MacOS", exe)).toString("latin1");
  return { code: IN_CODE.filter((m) => code.includes(m)), launcher: IN_LAUNCHER.filter((m) => launcher.includes(m)) };
}

const tests = readdirSync(builds)
  .filter((name) => name.startsWith("dev-macos-"))
  .flatMap((name) =>
    readdirSync(join(builds, name))
      .filter((n) => n.endsWith(".app"))
      .map((app) => join(builds, name, app)),
  );
let bad = 0;
try {
  if (tests.length !== 1) throw new Error(`expected one dev (CHANNELS_EB_TEST=1) .app under ${builds}, found ${tests.length}`);
  const release = marks(plainApp(dir, tmp));
  const test = marks(tests[0]!);
  if (release.code.length || release.launcher.length) {
    console.error(`eb-driver-check: the release build carries test-only code: ${[...release.code, ...release.launcher.map((m) => `${m} through its launcher`)].join(", ")}`);
    bad++;
  } else console.log("release build: no test driver, no relay override, and its launcher lets none of their variables through");
  const missing = [...IN_CODE.filter((m) => !test.code.includes(m)), ...IN_LAUNCHER.filter((m) => !test.launcher.includes(m)).map((m) => `${m} through its launcher`)];
  if (missing.length) {
    console.error(`eb-driver-check: the test build lacks ${missing.join(", ")}, so this check can't tell a release build from it`);
    bad++;
  } else console.log("test build: the driver, the relay override and their variables through the launcher are in");
} catch (e) {
  console.error(`eb-driver-check: ${e instanceof Error ? e.message : String(e)}`);
  bad++;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
