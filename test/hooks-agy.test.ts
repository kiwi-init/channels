import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { extraInstalled, hooksStatus, installDetected, installExtra, uninstallExtra } from "../src/hooks.ts";

const made: string[] = [];
const prev = new Map<string, string | undefined>();
const MAIN_TS = join(import.meta.dir, "..", "src", "cli", "main.ts");

function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

function setEnv(vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (!prev.has(k)) prev.set(k, process.env[k]);
    process.env[k] = v;
  }
}

afterEach(() => {
  for (const [k, v] of prev) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  prev.clear();
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made.length = 0;
});

type Handler = { type?: string; command: string; timeout?: number };
type Group = { matcher?: string; hooks: Handler[] };
type NamedHook = { enabled?: boolean } & Record<string, Handler[] | Group[] | boolean | undefined>;
type HooksFile = Record<string, NamedHook>;

const USER: HooksFile = {
  "lint-checker": { PostToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: "./scripts/lint.sh", timeout: 10 }] }] },
  reminder: { Stop: [{ type: "command", command: "./scripts/reminder.sh" }] },
};

function agyHome(): { dir: string; path: string } {
  const dir = scratch("hk-agy-");
  setEnv({ KIWI_HOME: scratch("hk-agy-home-"), KIWI_AGY_DIR: dir });
  return { dir, path: join(dir, "hooks.json") };
}

function readHooks(path: string): HooksFile {
  return JSON.parse(readFileSync(path, "utf8")) as HooksFile;
}

function kiwiCli(args: string[], env: Record<string, string>): { code: number; out: string; err: string } {
  const r = Bun.spawnSync([process.execPath, MAIN_TS, ...args], {
    cwd: scratch("hk-agy-cwd-"),
    env: { ...process.env, ...env },
    stdin: new TextEncoder().encode("{}"),
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

test("agy: a named kiwi hook in hooks.json beside the user's hooks, re-installed once, and uninstall gives the user's file back", () => {
  const { path } = agyHome();
  writeFileSync(path, JSON.stringify(USER, null, 2) + "\n");
  expect(extraInstalled("agy")).toBe(false);
  expect(hooksStatus()).toContain("agy: not installed");

  expect(installExtra("agy")).toBe(path);
  installExtra("agy");
  const file = readHooks(path);
  expect(Object.keys(file)).toEqual(["lint-checker", "reminder", "kiwi"]);
  expect(file["lint-checker"]).toEqual(USER["lint-checker"]!);
  expect(file.reminder).toEqual(USER.reminder!);
  expect(file.kiwi).toEqual({
    SessionStart: [{ type: "command", command: expect.stringMatching(/ --harness agy hook session-start # kiwi$/), timeout: 20 }],
    PreInvocation: [{ type: "command", command: expect.stringMatching(/ --harness agy hook prompt # kiwi$/), timeout: 20 }],
    Stop: [{ type: "command", command: expect.stringMatching(/ --harness agy hook stop # kiwi$/), timeout: 30 }],
  });
  expect(extraInstalled("agy")).toBe(true);
  expect(hooksStatus()).toContain("agy: installed");

  uninstallExtra("agy");
  expect(readHooks(path)).toEqual(USER);
  expect(extraInstalled("agy")).toBe(false);
});

test("agy: an absent hooks.json gets just Kiwi's hook, and is absent again after uninstall", () => {
  const { path } = agyHome();
  installExtra("agy");
  expect(Object.keys(readHooks(path))).toEqual(["kiwi"]);
  uninstallExtra("agy");
  expect(existsSync(path)).toBe(false);
  uninstallExtra("agy");
  expect(existsSync(path)).toBe(false);
});

test("agy: a hook a person named kiwi is never overwritten or removed", () => {
  const { path } = agyHome();
  const theirs: HooksFile = { ...USER, kiwi: { Stop: [{ type: "command", command: "./scripts/my-kiwi.sh" }] } };
  writeFileSync(path, JSON.stringify(theirs, null, 2) + "\n");
  expect(() => installExtra("agy")).toThrow(/already has a hook named "kiwi" that isn't Kiwi's/);
  expect(readHooks(path)).toEqual(theirs);
  expect(extraInstalled("agy")).toBe(false);
  uninstallExtra("agy");
  expect(readHooks(path)).toEqual(theirs);
});

test("agy: Kiwi's hook turned off in hooks.json counts as not installed, and an install turns it back on", () => {
  const { path } = agyHome();
  installExtra("agy");
  const off = readHooks(path);
  off.kiwi = { ...off.kiwi, enabled: false };
  writeFileSync(path, JSON.stringify(off, null, 2) + "\n");
  expect(extraInstalled("agy")).toBe(false);
  installExtra("agy");
  expect(readHooks(path).kiwi?.enabled).toBeUndefined();
  expect(extraInstalled("agy")).toBe(true);
});

function agyShell(): (env: Record<string, string>) => string {
  const bin = join(scratch("hk-agy-bin-"), "agy");
  symlinkSync(Bun.which("bash") ?? "/bin/bash", bin);
  const script = join(scratch("hk-agy-script-"), "join.ts");
  writeFileSync(script, `import { autoInstallExtraHooks } from ${JSON.stringify(join(import.meta.dir, "..", "src", "hooks.ts"))};\nconsole.log(JSON.stringify(autoInstallExtraHooks()));\n`);
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return (env) =>
    Bun.spawnSync([bin, "-c", `${quote(process.execPath)} ${quote(script)}; true`], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
      .stdout.toString()
      .trim();
}

test("agy: joining from inside agy installs its hooks, and a person's off keeps them out", () => {
  const { dir, path } = agyHome();
  const insideAgy = agyShell();
  const env = { KIWI_HOME: process.env.KIWI_HOME!, KIWI_AGY_DIR: dir, KIWI_NO_HOOKS: "", ANTIGRAVITY_AGENT: "1", ANTIGRAVITY_CONVERSATION_ID: "conv-1" };
  expect(insideAgy(env)).toBe(JSON.stringify(`Antigravity CLI hooks (${path})`));
  expect(Object.keys(readHooks(path).kiwi ?? {})).toEqual(["SessionStart", "PreInvocation", "Stop"]);
  expect(insideAgy(env)).toBe("null");

  uninstallExtra("agy");
  const home = scratch("hk-agy-off-home-");
  writeFileSync(join(home, "config.json"), JSON.stringify({ channels: {}, harnessHooks: { agy: "off" } }));
  setEnv({ KIWI_HOME: home });
  expect(loadConfig().harnessHooks?.agy).toBe("off");
  expect(insideAgy({ ...env, KIWI_HOME: home })).toBe("null");
  expect(installDetected()).not.toContain(path);
  expect(existsSync(path)).toBe(false);
});

test("agy: kiwi hooks install, status and uninstall agy, and its hooks answer nothing until they speak agy", () => {
  const dir = scratch("hk-agy-cli-");
  const path = join(dir, "hooks.json");
  const env = { KIWI_HOME: scratch("hk-agy-cli-home-"), KIWI_AGY_DIR: dir, KIWI_NO_HOOKS: "" };
  expect(kiwiCli(["hooks", "status", "agy"], env).out.trim()).toBe("agy: not installed");
  expect(kiwiCli(["hooks", "install", "agy"], env).out.trim()).toBe(`installed hooks in ${path}`);
  expect(kiwiCli(["hooks", "status", "agy"], env).out.trim()).toBe("agy: installed");
  expect(JSON.parse(kiwiCli(["hooks", "status", "agy", "--json"], env).out)).toEqual({ hooks: [{ harness: "agy", state: "installed", text: "installed" }] });

  for (const event of ["session-start", "prompt", "stop"]) {
    const r = kiwiCli(["--harness", "agy", "hook", event], { ...env, ANTIGRAVITY_AGENT: "1", ANTIGRAVITY_CONVERSATION_ID: "conv-1" });
    expect(r.code, event).toBe(0);
    expect(r.out, event).toBe("");
  }

  expect(kiwiCli(["hooks", "uninstall", "agy"], env).out.trim()).toBe(`removed hooks from ${path}`);
  expect(existsSync(path)).toBe(false);
  expect(kiwiCli(["hooks", "status", "agy", "--json"], env).out).toContain('"state":"off"');
});
