import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const IN_CODE = ["kiwiDriver", "KIWI_EB_DRIVER", "KIWI_EB_RELAY", "KIWI_EB_UI_CHANNEL", "kiwi-eb-test-store.json"];
export const IN_LAUNCHER = ["KIWI_EB_DRIVER", "KIWI_EB_RELAY", "KIWI_EB_UI_CHANNEL", "CFFIXED_USER_HOME", "KIWI_HOME"];
const IN_BOTH_CODE = ["views://internal/index.html", "restoreWindowFocusAfterExternalDrop"];
const IN_BOTH_LAUNCHER = ["BUN_RUNTIME_TRANSPILER_CACHE_PATH"];

export interface Layout {
  resources: string;
  launcher: string;
}

export interface Marks {
  code: string[];
  launcher: string[];
  unread: string[];
}

export function macLayout(app: string): Layout {
  const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
  const exe = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
  if (!exe) throw new Error(`${app}'s Info.plist names no CFBundleExecutable`);
  return { resources: join(app, "Contents", "Resources"), launcher: join(app, "Contents", "MacOS", exe) };
}

export const linuxLayout = (root: string): Layout => ({ resources: join(root, "Resources"), launcher: join(root, "bin", "launcher") });

function scripts(path: string, views: boolean): string[] {
  const st = statSync(path);
  if (st.isDirectory()) return readdirSync(path).flatMap((n) => (n === "views" && !views ? [] : scripts(join(path, n), views)));
  return /\.(c|m)?js$/.test(path) ? [path] : [];
}

export function marksOf({ resources, launcher }: Layout): Marks {
  const read = (views: boolean): string =>
    scripts(resources, views)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
  const code = read(false);
  const all = read(true);
  const bin = readFileSync(launcher).toString("latin1");
  return {
    code: IN_CODE.filter((m) => all.includes(m)),
    launcher: IN_LAUNCHER.filter((m) => bin.includes(m)),
    unread: [...IN_BOTH_CODE.filter((m) => !code.includes(m)), ...IN_BOTH_LAUNCHER.filter((m) => !bin.includes(m)).map((m) => `${m} in its launcher`)],
  };
}

export function releaseProblems(name: string, marks: Marks): string[] {
  const problems: string[] = [];
  if (marks.unread.length) problems.push(`${name} lacks ${marks.unread.join(", ")}, which every build has, so the check read the wrong files and proves nothing`);
  if (marks.code.length || marks.launcher.length) problems.push(`${name} carries test-only code: ${[...marks.code, ...marks.launcher.map((m) => `${m} through its launcher`)].join(", ")}`);
  return problems;
}

export const testEnvProblem = (env: NodeJS.ProcessEnv): string | null =>
  env["CHANNELS_EB_TEST"] ? `CHANNELS_EB_TEST is set (${JSON.stringify(env["CHANNELS_EB_TEST"])}), so this job may have built a test app: a release never sets it` : null;
