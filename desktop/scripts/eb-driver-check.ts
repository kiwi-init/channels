import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { payloadOf, shippedApp } from "./eb-app.ts";
import { LINUX_ENTRY } from "./eb-drive.ts";

const IN_CODE = ["kiwiDriver", "KIWI_EB_DRIVER", "KIWI_EB_RELAY", "kiwi-eb-test-store.json"];
const IN_LAUNCHER = ["KIWI_EB_DRIVER", "KIWI_EB_RELAY", "CFFIXED_USER_HOME", "KIWI_HOME"];
const IN_BOTH_CODE = ["views://internal/index.html", "restoreWindowFocusAfterExternalDrop"];
const IN_BOTH_LAUNCHER = ["BUN_RUNTIME_TRANSPILER_CACHE_PATH"];

const dir = resolve(process.argv[2] ?? "desktop/release-eb");
const installed = process.argv[3] ? resolve(process.argv[3]) : null;
const linux = process.platform === "linux";
const builds = join(dir, "build");
const tmp = mkdtempSync(join(tmpdir(), "eb-driver-check-"));

function scripts(path: string, views: boolean): string[] {
  const st = statSync(path);
  if (st.isDirectory()) return readdirSync(path).flatMap((n) => (n === "views" && !views ? [] : scripts(join(path, n), views)));
  return /\.(c|m)?js$/.test(path) ? [path] : [];
}

function marks(app: string): { code: string[]; launcher: string[]; unread: string[] } {
  const read = (views: boolean): string =>
    scripts(join(app, "Contents", "Resources"), views)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
  const code = read(false);
  const all = read(true);
  const exe = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
  const launcher = readFileSync(join(app, "Contents", "MacOS", exe)).toString("latin1");
  return {
    code: IN_CODE.filter((m) => all.includes(m)),
    launcher: IN_LAUNCHER.filter((m) => launcher.includes(m)),
    unread: [...IN_BOTH_CODE.filter((m) => !code.includes(m)), ...IN_BOTH_LAUNCHER.filter((m) => !launcher.includes(m)).map((m) => `${m} in its launcher`)],
  };
}

function linuxMarks(app: string): { code: string[]; launcher: string[]; unread: string[] } {
  const read = (views: boolean): string =>
    scripts(join(app, "Resources"), views)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
  const code = read(false);
  const all = read(true);
  const launcher = readFileSync(join(app, "bin", "launcher")).toString("latin1");
  return {
    code: IN_CODE.filter((m) => all.includes(m)),
    launcher: [],
    unread: [...IN_BOTH_CODE.filter((m) => !code.includes(m)), ...IN_BOTH_LAUNCHER.filter((m) => !launcher.includes(m)).map((m) => `${m} in its launcher`)],
  };
}

const tests = readdirSync(builds)
  .filter((name) => name.startsWith(linux ? "dev-linux-" : "dev-macos-"))
  .flatMap((name) =>
    readdirSync(join(builds, name))
      .map((app) => join(builds, name, app))
      .filter((app) => (linux ? existsSync(join(app, LINUX_ENTRY)) : app.endsWith(".app"))),
  );
let bad = 0;
try {
  if (tests.length !== 1) throw new Error(`expected one dev (CHANNELS_EB_TEST=1) app under ${builds}, found ${tests.length}`);
  if (linux && !installed) throw new Error("on Linux, name the installed release app (/opt/Channels, from the deb) after the build folder");
  const release = linux ? linuxMarks(installed!) : marks(shippedApp(payloadOf(join(dir, "artifacts")), tmp));
  const test = linux ? linuxMarks(tests[0]!) : marks(tests[0]!);
  for (const [name, read] of [
    ["release", release],
    ["test", test],
  ] as const) {
    if (!read.unread.length) continue;
    console.error(`eb-driver-check: the ${name} build lacks ${read.unread.join(", ")}, which every build has, so the check read the wrong files and proves nothing`);
    bad++;
  }
  if (release.code.length || release.launcher.length) {
    console.error(`eb-driver-check: the release build carries test-only code: ${[...release.code, ...release.launcher.map((m) => `${m} through its launcher`)].join(", ")}`);
    bad++;
  } else console.log(`release build: no test driver, no relay override, no plain-JSON test store${linux ? "" : ", and its launcher lets none of their variables through"}`);
  const missing = [...IN_CODE.filter((m) => !test.code.includes(m)), ...(linux ? [] : IN_LAUNCHER.filter((m) => !test.launcher.includes(m)).map((m) => `${m} through its launcher`))];
  if (missing.length) {
    console.error(`eb-driver-check: the test build lacks ${missing.join(", ")}, so this check can't tell a release build from it`);
    bad++;
  } else console.log(`test build: the driver, the relay override, the plain-JSON test store${linux ? "" : " and their variables through the launcher"} are in`);
} catch (e) {
  console.error(`eb-driver-check: ${e instanceof Error ? e.message : String(e)}`);
  bad++;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
