import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { payloadOf, shippedApp } from "./eb-app.ts";
import { LINUX_ENTRY } from "./eb-drive.ts";
import { APP_FOLDER, INSTALL_DIR } from "./linux-files.ts";
import { IN_CODE, IN_LAUNCHER, linuxLayout, macLayout, marksOf, releaseProblems, testEnvProblem, type Layout, type Marks } from "./eb-test-marks.ts";

const tmp = mkdtempSync(join(tmpdir(), "eb-driver-check-"));

const linux = process.platform === "linux";
const onLinux = (marks: Marks): Marks => (linux ? { ...marks, launcher: [] } : marks);

function testBuild(dir: string, installed: string | null): number {
  const builds = join(dir, "build");
  const tests = readdirSync(builds)
    .filter((name) => name.startsWith(linux ? "dev-linux-" : "dev-macos-"))
    .flatMap((name) =>
      readdirSync(join(builds, name))
        .map((app) => join(builds, name, app))
        .filter((app) => (linux ? existsSync(join(app, LINUX_ENTRY)) : app.endsWith(".app"))),
    );
  if (tests.length !== 1) throw new Error(`expected one dev (CHANNELS_EB_TEST=1) app under ${builds}, found ${tests.length}`);
  if (linux && !installed) throw new Error("on Linux, name the installed release app (${INSTALL_DIR}, from the deb) after the build folder");
  let bad = 0;
  const release = onLinux(marksOf(linux ? linuxLayout(installed!) : macLayout(shippedApp(payloadOf(join(dir, "artifacts")), tmp))));
  const test = onLinux(marksOf(linux ? linuxLayout(tests[0]!) : macLayout(tests[0]!)));
  if (test.unread.length) {
    console.error(`eb-driver-check: the test build lacks ${test.unread.join(", ")}, which every build has, so the check read the wrong files and proves nothing`);
    bad++;
  }
  for (const p of releaseProblems("the release build", release)) {
    console.error(`eb-driver-check: ${p}`);
    bad++;
  }
  if (!release.code.length && !release.launcher.length)
    console.log(`release build: no test driver, no relay override, no plain-JSON test store${linux ? "" : ", and its launcher lets none of their variables through"}`);
  const missing = [...IN_CODE.filter((m) => !test.code.includes(m)), ...(linux ? [] : IN_LAUNCHER.filter((m) => !test.launcher.includes(m)).map((m) => `${m} through its launcher`))];
  if (missing.length) {
    console.error(`eb-driver-check: the test build lacks ${missing.join(", ")}, so this check can't tell a release build from it`);
    bad++;
  } else console.log(`test build: the driver, the relay override, the plain-JSON test store${linux ? "" : " and their variables through the launcher"} are in`);
  return bad;
}

const appIn = (dir: string): string => {
  const apps = readdirSync(dir).filter((n) => n.endsWith(".app"));
  if (apps.length !== 1) throw new Error(`expected one .app in ${dir}, found ${apps.length}`);
  return join(dir, apps[0]!);
};

function shipped(file: string, into: string, cleanups: (() => void)[]): Layout {
  mkdirSync(into);
  if (file.endsWith(".zip")) {
    execFileSync("ditto", ["-x", "-k", file, into]);
    return macLayout(appIn(into));
  }
  if (file.endsWith(".dmg")) {
    const mount = join(into, "mount");
    mkdirSync(mount);
    execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, file], { stdio: "ignore" });
    cleanups.push(() => execFileSync("hdiutil", ["detach", "-force", mount], { stdio: "ignore" }));
    return macLayout(appIn(mount));
  }
  if (file.endsWith(".deb")) {
    execFileSync("dpkg-deb", ["-x", file, into]);
    return linuxLayout(join(into, INSTALL_DIR));
  }
  if (file.endsWith(".AppImage")) {
    chmodSync(file, 0o755);
    execFileSync(file, ["--appimage-extract"], { cwd: into, stdio: "ignore" });
    const root = join(into, "squashfs-root", APP_FOLDER);
    if (!existsSync(root)) throw new Error(`${basename(file)} has no ${APP_FOLDER} folder at its root`);
    return linuxLayout(root);
  }
  throw new Error(`${basename(file)} isn't a .zip, .dmg, .deb or .AppImage`);
}

function shippedFiles(files: string[]): number {
  const env = testEnvProblem(process.env);
  if (env) throw new Error(env);
  if (!files.length) throw new Error("usage: bun desktop/scripts/eb-driver-check.ts --release FILE...");
  let bad = 0;
  files.forEach((f, i) => {
    const file = resolve(f);
    const cleanups: (() => void)[] = [];
    try {
      const problems = releaseProblems(basename(file), marksOf(shipped(file, join(tmp, String(i)), cleanups)));
      for (const p of problems) console.error(`eb-driver-check: ${p}`);
      if (problems.length) bad++;
      else console.log(`${basename(file)}: no test driver, no relay override, no plain-JSON test store, and its launcher lets none of their variables through`);
    } finally {
      for (const c of cleanups) c();
    }
  });
  return bad;
}

let bad = 0;
try {
  bad = process.argv[2] === "--release" ? shippedFiles(process.argv.slice(3)) : testBuild(resolve(process.argv[2] ?? "desktop/release-eb"), process.argv[3] ? resolve(process.argv[3]) : null);
} catch (e) {
  console.error(`eb-driver-check: ${e instanceof Error ? e.message : String(e)}`);
  bad++;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
