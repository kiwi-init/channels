import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MARKS = ["kiwiDriver", "KIWI_EB_DRIVER", "KIWI_EB_RELAY"];

const dir = resolve(process.argv[2] ?? "desktop/release-eb");
const builds = join(dir, "build");

function apps(env: string): string[] {
  return readdirSync(builds)
    .filter((name) => name.startsWith(`${env}-macos-`))
    .flatMap((name) =>
      readdirSync(join(builds, name))
        .filter((n) => n.endsWith(".app"))
        .map((app) => join(builds, name, app)),
    );
}

function scripts(path: string): string[] {
  const st = statSync(path);
  if (st.isDirectory()) return readdirSync(path).flatMap((n) => (n === "views" ? [] : scripts(join(path, n))));
  return /\.(c|m)?js$/.test(path) ? [path] : [];
}

function marksIn(app: string): string[] {
  const code = scripts(join(app, "Contents", "Resources", "app"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  return MARKS.filter((m) => code.includes(m));
}

const stable = apps("stable");
const test = apps("dev");
if (stable.length !== 1 || test.length !== 1) {
  console.error(`eb-driver-check: expected one stable and one dev (CHANNELS_EB_TEST=1) .app under ${builds}, found ${stable.length} and ${test.length}`);
  process.exit(1);
}
const inStable = marksIn(stable[0]!);
const inTest = marksIn(test[0]!);
let bad = 0;
if (inStable.length) {
  console.error(`eb-driver-check: the release build carries the test driver (${inStable.join(", ")}): KIWI_EB_TEST must be false there`);
  bad++;
} else console.log("release build: no test driver, no relay override");
if (inTest.length !== MARKS.length) {
  console.error(`eb-driver-check: the test build lacks ${MARKS.filter((m) => !inTest.includes(m)).join(", ")}, so this check can't tell a release build from it`);
  bad++;
} else console.log("test build: the driver and the relay override are in");
process.exit(bad ? 1 : 0);
