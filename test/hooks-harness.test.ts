// Per-harness hook files: write, idempotent re-install, uninstall leaves the user's own entries.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/config.ts";
import { VERSION } from "../src/version.ts";
import {
  autoInstallExtraHooks,
  autoInstallHooks,
  backgroundTasks,
  cursorStopFollowup,
  extraInstalled,
  fitting,
  grokMonitorListens,
  hooksInstalled,
  hooksListen,
  hooksStatus,
  installedListenSeconds,
  installDetected,
  installExtra,
  installHooks,
  isOurHook,
  kimiReason,
  migrateExtraHooks,
  migrateClaudeHooks,
  PROBE_MS,
  PROBE_TTL_MS,
  rewakeCapable,
  selfIdentity,
  uninstallHooks,
  stopStyle,
  uninstallDetected,
  uninstallExtra,
  withKimiHooks,
  withoutKimiHooks,
} from "../src/hooks.ts";

const made: string[] = [];
const prev = new Map<string, string | undefined>();

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

function hideEnv(keys: string[]): void {
  for (const k of keys) {
    if (!prev.has(k)) prev.set(k, process.env[k]);
    delete process.env[k];
  }
}

const SESSION_ENVS = [
  "CODEX_THREAD_ID",
  "GEMINI_CLI",
  "CURSOR_AGENT",
  "GROK_SESSION_ID",
  "GROK_AGENT",
  "KIWI_NO_HOOKS",
  "CLAUDECODE",
  "PI_CODING_AGENT",
  "KIWI_PI_PID",
  "KIWI_PI_SESSION",
  "KIWI_LAUNCH",
  "MIMOCODE",
  "MIMOCODE_PID",
  "MIMOCODE_SESSION_ID",
];

afterEach(() => {
  for (const [k, v] of prev) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  prev.clear();
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made.length = 0;
});

interface Hook {
  command: string;
  timeout?: number;
  loop_limit?: number;
}

interface HookGroup {
  matcher?: string;
  hooks: Hook[];
}

interface GroupedHooks {
  theme?: string;
  hooks: { Stop: HookGroup[]; UserPromptSubmit?: HookGroup[]; SessionStart?: HookGroup[]; BeforeAgent: HookGroup[]; AfterAgent: HookGroup[]; PostToolUse: HookGroup[] };
}

interface CursorHooks {
  version: number;
  hooks: { stop: Hook[]; preToolUse: Hook[]; sessionStart?: Hook[] };
}

function read(path: string): GroupedHooks {
  return JSON.parse(readFileSync(path, "utf8")) as GroupedHooks;
}

function readCursor(path: string): CursorHooks {
  return JSON.parse(readFileSync(path, "utf8")) as CursorHooks;
}

function realHomeStamp(): string {
  const root = homedir();
  const paths = [
    join(root, ".grok"),
    join(root, ".grok", "hooks"),
    join(root, ".grok", "hooks", "kiwi.json"),
    join(root, ".codex"),
    join(root, ".codex", "hooks.json"),
    join(root, ".cursor"),
    join(root, ".cursor", "hooks.json"),
    join(root, ".gemini"),
    join(root, ".gemini", "settings.json"),
    join(root, ".kimi-code"),
    join(root, ".kimi-code", "config.toml"),
    join(root, ".pi"),
    join(root, ".pi", "agent", "extensions", "kiwi.ts"),
    join(root, ".config", "mimocode"),
    join(root, ".config", "mimocode", "plugin"),
    join(root, ".config", "mimocode", "plugin", "kiwi.ts"),
    join(root, ".zcode", "cli"),
    join(root, ".zcode", "cli", "config.json"),
    join(root, ".claude"),
    join(root, ".claude", "settings.json"),
  ];
  return paths
    .map((p) => {
      try {
        const s = statSync(p);
        return `${p} ${s.mtimeMs} ${s.size} ${s.mode}`;
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT") return `${p} absent`;
        throw e;
      }
    })
    .join("\n");
}

test("a harness session during tests does not touch the real home", () => {
  const root = homedir();
  for (const key of ["KIWI_CODEX_DIR", "KIWI_GEMINI_DIR", "KIWI_CURSOR_DIR", "KIWI_GROK_DIR", "KIWI_KIMI_DIR", "KIWI_PI_DIR", "KIWI_MIMO_DIR", "KIWI_ZCODE_DIR", "CLAUDE_CONFIG_DIR"]) {
    const dir = process.env[key];
    expect(dir, key).toBeTruthy();
    expect(dir!.startsWith(`${root}/`), key).toBe(false);
  }
  expect(process.env.CLAUDECODE).toBeUndefined();
  expect(process.env.CODEX_THREAD_ID).toBeUndefined();
  expect(process.env.GEMINI_CLI).toBeUndefined();
  expect(process.env.CURSOR_AGENT).toBeUndefined();
  expect(process.env.GROK_SESSION_ID).toBeUndefined();

  const before = realHomeStamp();
  setEnv({
    KIWI_HOME: scratch("hk-preload-home-"),
    CLAUDECODE: "1",
    CODEX_THREAD_ID: "thr_test",
    GEMINI_CLI: "1",
    CURSOR_AGENT: "1",
  });
  expect(autoInstallHooks()).toContain(process.env.CLAUDE_CONFIG_DIR!);
  const extras = autoInstallExtraHooks();
  expect(extras).toContain("Codex hooks");
  expect(extras).toContain("Gemini hooks");
  expect(extras).toContain("Cursor hooks");
  installDetected();
  expect(existsSync(join(process.env.KIWI_GROK_DIR!, "hooks", "kiwi.json"))).toBe(true);
  expect(existsSync(join(process.env.KIWI_KIMI_DIR!, "config.toml"))).toBe(true);
  expect(existsSync(join(process.env.KIWI_PI_DIR!, "extensions", "kiwi.ts"))).toBe(true);
  expect(existsSync(join(process.env.KIWI_MIMO_DIR!, "plugin", "kiwi.ts"))).toBe(true);
  expect(existsSync(join(process.env.KIWI_ZCODE_DIR!, "config.json"))).toBe(true);
  uninstallDetected();
  expect(realHomeStamp()).toBe(before);
});

test("CLAUDECODE plus GROK_SESSION_ID does not write Claude settings", () => {
  const claude = scratch("hk-grok-compat-");
  setEnv({
    KIWI_HOME: scratch("hk-grok-compat-home-"),
    CLAUDE_CONFIG_DIR: claude,
    CLAUDECODE: "1",
    GROK_SESSION_ID: "sess_test",
  });
  expect(autoInstallHooks()).toBeNull();
  expect(existsSync(join(claude, "settings.json"))).toBe(false);
  const extras = autoInstallExtraHooks();
  expect(extras).toContain("Grok hooks");
  expect(existsSync(join(process.env.KIWI_GROK_DIR!, "hooks", "kiwi.json"))).toBe(true);
});

test("Codex hooks go to CODEX_HOME, and KIWI_CODEX_DIR still wins over it", () => {
  const home = scratch("hk-codex-home-");
  const over = scratch("hk-codex-over-");
  hideEnv(["KIWI_CODEX_DIR"]);
  setEnv({ KIWI_HOME: scratch("hk-codex-home-kiwi-"), CODEX_HOME: home });
  expect(installExtra("codex")).toBe(join(home, "hooks.json"));
  expect(extraInstalled("codex")).toBe(true);
  setEnv({ KIWI_CODEX_DIR: over });
  expect(installExtra("codex")).toBe(join(over, "hooks.json"));
});

test("codex, gemini, cursor, and grok install, re-install once, and uninstall keeps user entries", () => {
  const claude = scratch("hk-claude-");
  const codex = scratch("hk-codex-");
  const gemini = scratch("hk-gemini-");
  const cursor = scratch("hk-cursor-");
  const grok = scratch("hk-grok-");
  const home = scratch("hk-home-");
  setEnv({
    KIWI_HOME: home,
    CLAUDE_CONFIG_DIR: claude,
    KIWI_CODEX_DIR: codex,
    KIWI_GEMINI_DIR: gemini,
    KIWI_CURSOR_DIR: cursor,
    KIWI_GROK_DIR: grok,
  });

  writeFileSync(
    join(codex, "hooks.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo mine # kiwi" },
              { type: "command", command: "'/old/kiwi' hook stop # channel-one" },
            ],
          },
        ],
      },
    }),
  );
  writeFileSync(join(gemini, "settings.json"), JSON.stringify({ theme: "dark", hooks: { BeforeAgent: [{ matcher: "startup", hooks: [{ type: "command", command: "echo gemini-user" }] }] } }));
  writeFileSync(join(cursor, "hooks.json"), JSON.stringify({ version: 1, hooks: { stop: [{ command: "echo cursor-user # kiwi" }], preToolUse: [{ command: "echo tool" }] } }));
  mkdirSync(join(grok, "hooks"), { recursive: true });
  writeFileSync(join(grok, "hooks", "kiwi.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "echo grok-user" }] }] } }));

  installHooks();
  installExtra("codex");
  installExtra("gemini");
  installExtra("cursor");
  installExtra("grok");
  installExtra("codex");
  installExtra("gemini");
  installExtra("cursor");
  installExtra("grok");

  const codexStop = read(join(codex, "hooks.json")).hooks.Stop.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
  expect(codexStop).toContain("echo mine # kiwi");
  expect(codexStop).toContain("'/old/kiwi' hook stop # channel-one");
  expect(codexStop.filter((c: string) => c.endsWith(" hook stop # kiwi"))).toHaveLength(1);
  expect(codexStop.filter((c: string) => c.endsWith(" --harness codex hook stop # kiwi"))).toHaveLength(1);
  expect(read(join(codex, "hooks.json")).hooks.UserPromptSubmit).toBeDefined();
  expect(read(join(codex, "hooks.json")).hooks.SessionStart).toBeDefined();

  const gem = read(join(gemini, "settings.json"));
  expect(gem.theme).toBe("dark");
  const before = gem.hooks.BeforeAgent.flatMap((e: { hooks: { command: string; timeout?: number }[] }) => e.hooks);
  expect(before.map((h: { command: string }) => h.command)).toContain("echo gemini-user");
  expect(before.filter((h: { command: string }) => h.command.endsWith(" hook prompt # kiwi"))).toHaveLength(1);
  expect(before.find((h: { command: string }) => h.command.endsWith(" hook prompt # kiwi"))?.timeout).toBe(20_000);
  expect(before.filter((h: { command: string }) => h.command.endsWith(" --harness gemini hook prompt # kiwi"))).toHaveLength(1);
  expect(gem.hooks.AfterAgent[0]?.matcher).toBe("*");
  expect(gem.hooks.AfterAgent[0]?.hooks[0]?.timeout).toBe(30_000);
  expect(gem.hooks.UserPromptSubmit).toBeUndefined();

  const cur = readCursor(join(cursor, "hooks.json"));
  expect(cur.version).toBe(1);
  const curStop = cur.hooks.stop.map((h: { command: string; loop_limit?: number }) => h);
  expect(curStop.map((h: { command: string }) => h.command)).toContain("echo cursor-user # kiwi");
  expect(curStop.filter((h: { command: string }) => h.command.endsWith(" hook stop # kiwi"))).toHaveLength(1);
  expect(curStop.find((h: { command: string }) => h.command.endsWith(" hook stop # kiwi"))?.loop_limit).toBe(5);
  expect(cur.hooks.preToolUse).toEqual([{ command: "echo tool" }]);
  expect(cur.hooks.sessionStart?.some((h: { command: string }) => h.command.endsWith(" hook session-start # kiwi"))).toBe(true);

  const claudeStop = read(join(claude, "settings.json")).hooks.Stop.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
  const grokStop = read(join(grok, "hooks", "kiwi.json")).hooks.Stop.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
  const ours = (list: string[]) => list.find((c) => c.endsWith(" hook stop # kiwi"));
  expect(ours(claudeStop)).not.toContain("--harness");
  expect(ours(grokStop)).toBe(ours(claudeStop)?.replace(" hook stop # kiwi", " --harness grok hook stop # kiwi"));
  expect(read(join(grok, "hooks", "kiwi.json")).hooks.PostToolUse[0]?.hooks[0]?.command).toBe("echo grok-user");
  expect(read(join(grok, "hooks", "kiwi.json")).hooks.UserPromptSubmit).toBeUndefined();
  expect(read(join(grok, "hooks", "kiwi.json")).hooks.SessionStart).toBeUndefined();

  uninstallExtra("codex");
  uninstallExtra("gemini");
  uninstallExtra("cursor");
  uninstallExtra("grok");

  const codexLeft = read(join(codex, "hooks.json")).hooks.Stop.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
  expect(codexLeft).toEqual(["echo mine # kiwi", "'/old/kiwi' hook stop # channel-one"]);
  const gemLeft = read(join(gemini, "settings.json"));
  expect(gemLeft.theme).toBe("dark");
  expect(gemLeft.hooks.BeforeAgent.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command))).toEqual(["echo gemini-user"]);
  expect(gemLeft.hooks.AfterAgent).toBeUndefined();
  const curLeft = readCursor(join(cursor, "hooks.json"));
  expect(curLeft.version).toBe(1);
  expect(curLeft.hooks.stop).toEqual([{ command: "echo cursor-user # kiwi" }]);
  expect(curLeft.hooks.preToolUse).toEqual([{ command: "echo tool" }]);
  expect(curLeft.hooks.sessionStart).toBeUndefined();
  expect(read(join(grok, "hooks", "kiwi.json")).hooks.PostToolUse[0]?.hooks[0]?.command).toBe("echo grok-user");
  expect(read(join(grok, "hooks", "kiwi.json")).hooks.Stop).toBeUndefined();
  expect(extraInstalled("codex")).toBe(false);
  expect(extraInstalled("grok")).toBe(false);
});

test("a harness opted out stays out of install, and a named install turns it back on", () => {
  const home = scratch("hk-opt-home-");
  const claude = scratch("hk-opt-claude-");
  const codex = scratch("hk-opt-codex-");
  const absent = join(scratch("hk-opt-absent-"), "missing");
  setEnv({
    KIWI_HOME: home,
    CLAUDE_CONFIG_DIR: claude,
    KIWI_CODEX_DIR: codex,
    KIWI_GEMINI_DIR: absent,
    KIWI_CURSOR_DIR: absent,
    KIWI_GROK_DIR: absent,
    KIWI_KIMI_DIR: absent,
    KIWI_PI_DIR: absent,
    KIWI_MIMO_DIR: absent,
    KIWI_ZCODE_DIR: absent,
  });
  updateConfig((c) => {
    c.harnessHooks = { codex: "off" };
  });
  const paths = installDetected();
  expect(paths).toEqual([join(claude, "settings.json")]);
  expect(existsSync(join(codex, "hooks.json"))).toBe(false);

  installExtra("codex");
  expect(extraInstalled("codex")).toBe(true);
  updateConfig((c) => {
    c.harnessHooks = { ...loadConfig().harnessHooks, codex: "on" };
  });
  installDetected();
  const stop = read(join(codex, "hooks.json")).hooks.Stop.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
  expect(stop.filter((c: string) => c.endsWith(" hook stop # kiwi"))).toHaveLength(1);
});

test("stop style keeps Grok on the Claude block path and Cursor on followup", () => {
  expect(stopStyle({})).toBe("block");
  expect(stopStyle({ hook_event_name: "Stop" })).toBe("block");
  expect(stopStyle({ hook_event_name: "Stop", status: "completed", loop_count: 0 })).toBe("block");
  expect(stopStyle({ hook_event_name: "AfterAgent" })).toBe("gemini");
  expect(stopStyle({ status: "completed", loop_count: 0 })).toBe("cursor");
  expect(stopStyle({ status: "aborted" })).toBe("cursor");

  const mc = "kiwi -c proj --as mac";
  const unread = cursorStopFollowup("proj", mc, true);
  expect(unread).toBe(`Unread Kiwi messages (proj). Run \`${mc} read\`, answer with \`${mc} reply N "…"\`, then continue.`);
  expect(unread!.length).toBeLessThan(180);
  expect(unread).not.toContain("\n");
  expect(cursorStopFollowup("proj", mc, false)).toBeNull();
});

function harnessHomes(): { home: string; codex: string; gemini: string; cursor: string; grok: string } {
  const home = scratch("hk-auto-home-");
  const codex = scratch("hk-auto-codex-");
  const gemini = scratch("hk-auto-gemini-");
  const cursor = scratch("hk-auto-cursor-");
  const grok = scratch("hk-auto-grok-");
  setEnv({
    KIWI_HOME: home,
    CLAUDE_CONFIG_DIR: scratch("hk-auto-claude-"),
    KIWI_CODEX_DIR: codex,
    KIWI_GEMINI_DIR: gemini,
    KIWI_CURSOR_DIR: cursor,
    KIWI_GROK_DIR: grok,
  });
  hideEnv(SESSION_ENVS);
  return { home, codex, gemini, cursor, grok };
}

test("joining from inside a harness installs that harness only", () => {
  const dirs = harnessHomes();
  const cases = [
    ["codex", "CODEX_THREAD_ID", "thr_1", join(dirs.codex, "hooks.json"), "Codex"],
    ["gemini", "GEMINI_CLI", "1", join(dirs.gemini, "settings.json"), "Gemini"],
    ["cursor", "CURSOR_AGENT", "1", join(dirs.cursor, "hooks.json"), "Cursor"],
    ["grok", "GROK_SESSION_ID", "sess-1", join(dirs.grok, "hooks", "kiwi.json"), "Grok"],
  ] as const;
  for (const [name, env, value, path, label] of cases) {
    hideEnv(SESSION_ENVS);
    setEnv({ [env]: value });
    const wrote = autoInstallExtraHooks();
    expect(wrote).toContain(`${label} hooks (${path})`);
    expect(autoInstallExtraHooks()).toBeNull();
    expect(extraInstalled(name)).toBe(true);
  }
  expect(existsSync(join(dirs.codex, "hooks.json"))).toBe(true);
  expect(existsSync(join(dirs.gemini, "settings.json"))).toBe(true);
  expect(existsSync(join(dirs.cursor, "hooks.json"))).toBe(true);
  expect(existsSync(join(dirs.grok, "hooks", "kiwi.json"))).toBe(true);
  const grokStop = read(join(dirs.grok, "hooks", "kiwi.json")).hooks.Stop.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
  expect(grokStop.filter((c: string) => c.endsWith(" hook stop # kiwi"))).toHaveLength(1);
  expect(read(join(dirs.grok, "hooks", "kiwi.json")).hooks.UserPromptSubmit).toBeUndefined();
});

test("join skips a harness that is off, opted out by KIWI_NO_HOOKS, or not the current session", () => {
  const dirs = harnessHomes();
  updateConfig((c) => {
    c.harnessHooks = { codex: "off" };
  });
  setEnv({ CODEX_THREAD_ID: "thr_1" });
  expect(autoInstallExtraHooks()).toBeNull();
  expect(existsSync(join(dirs.codex, "hooks.json"))).toBe(false);
  expect(loadConfig().harnessHooks?.codex).toBe("off");

  updateConfig((c) => {
    c.harnessHooks = {};
  });
  setEnv({ KIWI_NO_HOOKS: "1", GEMINI_CLI: "1" });
  expect(autoInstallExtraHooks()).toBeNull();
  expect(existsSync(join(dirs.gemini, "settings.json"))).toBe(false);

  hideEnv(SESSION_ENVS);
  setEnv({ GROK_AGENT: "1", CURSOR_AGENT: "" });
  expect(autoInstallExtraHooks()).toBeNull();
  expect(existsSync(join(dirs.cursor, "hooks.json"))).toBe(false);
  expect(existsSync(join(dirs.grok, "hooks", "kiwi.json"))).toBe(false);
  expect(autoInstallHooks()).toBeNull();
});

test("a corrupt harness file does not fail join", () => {
  const dirs = harnessHomes();
  writeFileSync(join(dirs.codex, "hooks.json"), "{");
  setEnv({ CODEX_THREAD_ID: "thr_1", GEMINI_CLI: "1" });
  expect(autoInstallExtraHooks()).toContain("Gemini hooks");
  expect(existsSync(join(dirs.gemini, "settings.json"))).toBe(true);
  expect(readFileSync(join(dirs.codex, "hooks.json"), "utf8")).toBe("{");
});

test("the listener: installed from a Claude Code that runs it, kept by an install that can't tell, removed by an older one", () => {
  hideEnv(["AI_AGENT", "CLAUDE_CODE_EXECPATH", "CLAUDECODE"]);
  setEnv({ CLAUDE_CONFIG_DIR: scratch("kiwi-listen-claude-") });
  const has = () => readFileSync(join(process.env.CLAUDE_CONFIG_DIR!, "settings.json"), "utf8").includes(" hook listen # kiwi");
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" });
  installHooks();
  expect(has()).toBe(true);
  // kiwi setup / hooks install in a plain terminal: no version to go by, so the listener stays.
  hideEnv(["AI_AGENT", "CLAUDECODE"]);
  installHooks();
  expect(has()).toBe(true);
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-100_agent" });
  installHooks();
  expect(has()).toBe(false);
});

test("the listener's day is a week; an install with the old one-day timeout counts as not installed, and its listener keeps to it until rewritten", () => {
  hideEnv(["AI_AGENT", "CLAUDE_CODE_EXECPATH", "CLAUDECODE"]);
  setEnv({ CLAUDE_CONFIG_DIR: scratch("kiwi-listen-day-") });
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" });
  installHooks();
  expect(hooksInstalled()).toBe(true);
  expect(installedListenSeconds()).toBe(7 * 24 * 3600 + 60);
  const file = join(process.env.CLAUDE_CONFIG_DIR!, "settings.json");
  writeFileSync(file, readFileSync(file, "utf8").replaceAll(`"timeout": ${7 * 24 * 3600 + 60}`, '"timeout": 86460'));
  expect(installedListenSeconds()).toBe(86460);
  expect(hooksInstalled()).toBe(false);
  installHooks();
  expect(installedListenSeconds()).toBe(7 * 24 * 3600 + 60);
});

test("a listen hook written by 0.19 (one-day timeout) is migrated on its own and then counts as installed; no kiwi entries stay untouched", () => {
  hideEnv(["AI_AGENT", "CLAUDE_CODE_EXECPATH", "CLAUDECODE"]);
  const dir = scratch("kiwi-listen-migrate-");
  setEnv({ KIWI_HOME: scratch("kiwi-listen-migrate-home-"), CLAUDE_CONFIG_DIR: dir });
  const file = join(dir, "settings.json");
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" });
  installHooks();
  writeFileSync(file, readFileSync(file, "utf8").replaceAll(`"timeout": ${7 * 24 * 3600 + 60}`, '"timeout": 86460'));
  hideEnv(["AI_AGENT", "CLAUDECODE"]);
  expect(hooksInstalled()).toBe(false);
  expect(hooksStatus()).toContain("claude: not installed (its listening hooks are from an older kiwi or incomplete: kiwi hooks install)");
  expect(installHooks()).toBe(file);
  expect(installedListenSeconds()).toBe(7 * 24 * 3600 + 60);
  writeFileSync(file, readFileSync(file, "utf8").replaceAll(`"timeout": ${7 * 24 * 3600 + 60}`, '"timeout": 86460'));
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" });
  expect(hooksListen()).toBe(false);
  expect(migrateClaudeHooks()).toBe(file);
  expect(installedListenSeconds()).toBe(7 * 24 * 3600 + 60);
  expect(hooksInstalled()).toBe(true);
  expect(hooksListen()).toBe(true);
  expect(migrateClaudeHooks()).toBeNull();

  const mine = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo mine" }] }] } }, null, 2) + "\n";
  writeFileSync(file, mine);
  expect(migrateClaudeHooks()).toBeNull();
  expect(readFileSync(file, "utf8")).toBe(mine);
});

type HookFile = { hooks: Record<string, { hooks: { command: string; timeout?: number }[] }[]> };

function listenTimeouts(file: string): Record<string, number[]> {
  const s = JSON.parse(readFileSync(file, "utf8")) as HookFile;
  return Object.fromEntries(
    Object.entries(s.hooks).map(([event, entries]) => [event, entries.flatMap((e) => e.hooks.filter((h) => h.command.endsWith(" hook listen # kiwi")).map((h) => h.timeout ?? 0))]),
  );
}

test("a migration repairs every listen entry kiwi has: stale on two events and missing on Stop ends current on all three", () => {
  hideEnv(["AI_AGENT", "CLAUDE_CODE_EXECPATH", "CLAUDECODE"]);
  const dir = scratch("kiwi-listen-partial-");
  setEnv({ KIWI_HOME: scratch("kiwi-listen-partial-home-"), CLAUDE_CONFIG_DIR: dir });
  const file = join(dir, "settings.json");
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" });
  installHooks();
  const s = JSON.parse(readFileSync(file, "utf8").replaceAll(`"timeout": ${7 * 24 * 3600 + 60}`, '"timeout": 86460')) as HookFile;
  s.hooks.Stop = (s.hooks.Stop ?? []).filter((e) => !e.hooks.some((h) => h.command.endsWith(" hook listen # kiwi")));
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  expect(listenTimeouts(file)).toEqual({ SessionStart: [86460], UserPromptSubmit: [86460], Stop: [], PermissionRequest: [] });
  hideEnv(["AI_AGENT"]);
  expect(migrateClaudeHooks()).toBe(file);
  const week = 7 * 24 * 3600 + 60;
  expect(listenTimeouts(file)).toEqual({ SessionStart: [week], UserPromptSubmit: [week], Stop: [week], PermissionRequest: [] });
  expect(hooksStatus()).toContain("claude: installed");
  expect(hooksListen()).toBe(true);
});

test("kiwi hooks status and the SessionStart check give the same answer for the same settings", () => {
  hideEnv(["AI_AGENT", "CLAUDE_CODE_EXECPATH", "CLAUDECODE"]);
  const dir = scratch("kiwi-listen-agree-");
  setEnv({ KIWI_HOME: scratch("kiwi-listen-agree-home-"), CLAUDE_CONFIG_DIR: dir });
  const file = join(dir, "settings.json");
  const inClaude = { CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" };
  setEnv(inClaude);
  installHooks();
  const current = readFileSync(file, "utf8");
  const stale = current.replaceAll(`"timeout": ${7 * 24 * 3600 + 60}`, '"timeout": 86460');
  const parsed = JSON.parse(current) as HookFile;
  for (const event of Object.keys(parsed.hooks)) parsed.hooks[event] = (parsed.hooks[event] ?? []).filter((e) => !e.hooks.some((h) => h.command.endsWith(" hook listen # kiwi")));
  const absent = JSON.stringify(parsed, null, 2) + "\n";
  const answers = [current, stale, absent].map((text) => {
    writeFileSync(file, text);
    setEnv(inClaude);
    const sessionStart = hooksListen();
    const inside = hooksStatus().split("\n")[0];
    hideEnv(["AI_AGENT", "CLAUDECODE"]);
    const shell = hooksStatus().split("\n")[0];
    return { sessionStart, inside: inside === "claude: installed", shell: shell === "claude: installed" };
  });
  expect(answers).toEqual([
    { sessionStart: true, inside: true, shell: true },
    { sessionStart: false, inside: false, shell: false },
    { sessionStart: false, inside: false, shell: false },
  ]);
});

function oldCodexHooks(codex: string): string {
  const file = join(codex, "hooks.json");
  const entry = (arg: string) => ({ hooks: [{ type: "command", command: `'/old/kiwi' hook ${arg} # kiwi` }] });
  writeFileSync(
    file,
    JSON.stringify({ hooks: { SessionStart: [entry("session-start")], UserPromptSubmit: [entry("prompt")], Stop: [entry("stop"), { hooks: [{ type: "command", command: "echo mine" }] }] } }),
  );
  return file;
}

function codexCommands(file: string): string[] {
  const { hooks } = read(file);
  return [...(hooks.SessionStart ?? []), ...(hooks.UserPromptSubmit ?? []), ...hooks.Stop].flatMap((e) => e.hooks.map((h) => h.command));
}

test("Codex hooks an older kiwi wrote without --harness are stale, and are rewritten flagged without anyone asking", () => {
  const codex = scratch("hk-old-codex-");
  const grok = scratch("hk-old-grok-");
  setEnv({ KIWI_HOME: scratch("hk-old-home-"), KIWI_CODEX_DIR: codex, KIWI_GROK_DIR: grok, KIWI_GEMINI_DIR: scratch("hk-old-gemini-") });
  hideEnv(["KIWI_NO_HOOKS"]);
  const file = oldCodexHooks(codex);
  expect(extraInstalled("codex")).toBe(false);
  expect(hooksStatus()).toContain("codex: not installed (its hooks are from an older kiwi: kiwi hooks install)");
  expect(hooksStatus()).toContain("grok: not installed");
  expect(hooksStatus()).not.toContain("grok: not installed (");

  setEnv({ KIWI_NO_HOOKS: "1" });
  expect(migrateExtraHooks()).toEqual([]);
  hideEnv(["KIWI_NO_HOOKS"]);
  updateConfig((c) => {
    c.harnessHooks = { codex: "off" };
  });
  expect(migrateExtraHooks()).toEqual([]);
  expect(codexCommands(file).filter((c) => c.startsWith("'/old/kiwi'"))).toHaveLength(3);
  updateConfig((c) => {
    c.harnessHooks = {};
  });

  expect(migrateExtraHooks()).toEqual([file]);
  const commands = codexCommands(file);
  expect(commands).toContain("echo mine");
  expect(commands.filter((c) => c.startsWith("'/old/kiwi'"))).toEqual([]);
  expect(commands.filter((c) => c.includes(" --harness codex hook "))).toHaveLength(3);
  expect(extraInstalled("codex")).toBe(true);
  expect(hooksStatus()).toContain("codex: installed");
  expect(existsSync(join(grok, "hooks", "kiwi.json"))).toBe(false);
  expect(migrateExtraHooks()).toEqual([]);
});

test("an unflagged kiwi hook run rewrites an older kiwi's Codex hooks", () => {
  const codex = scratch("hk-run-codex-");
  const env = { KIWI_HOME: scratch("hk-run-home-"), KIWI_CODEX_DIR: codex, KIWI_GROK_DIR: scratch("hk-run-grok-"), KIWI_GEMINI_DIR: scratch("hk-run-gemini-"), KIWI_NO_HOOKS: "", CLAUDECODE: "" };
  const file = oldCodexHooks(codex);
  expect(kiwiCli(["hooks", "status", "codex"], env).out.trim()).toBe("codex: not installed (its hooks are from an older kiwi: kiwi hooks install)");
  expect(kiwiCli(["hook", "stop"], env).code).toBe(0);
  expect(codexCommands(file).filter((c) => c.includes(" --harness codex hook "))).toHaveLength(3);
  expect(kiwiCli(["hooks", "status", "codex"], env).out.trim()).toBe("codex: installed");
});

test("kiwi hooks status --json gives the app each harness's state, and install claude --listen adds the listening hooks from outside Claude Code (T13)", () => {
  const none = join(scratch("hk-json-none-"), "absent");
  const env = {
    KIWI_HOME: scratch("hk-json-home-"),
    CLAUDE_CONFIG_DIR: scratch("hk-json-claude-"),
    KIWI_CODEX_DIR: scratch("hk-json-codex-"),
    KIWI_GEMINI_DIR: none,
    KIWI_CURSOR_DIR: none,
    KIWI_GROK_DIR: none,
    KIWI_KIMI_DIR: none,
    KIWI_PI_DIR: none,
    KIWI_MIMO_DIR: none,
    KIWI_ZCODE_DIR: none,
    KIWI_NO_HOOKS: "",
    CLAUDECODE: "",
    AI_AGENT: "",
    CLAUDE_CODE_EXECPATH: "",
  };
  const states = () => Object.fromEntries((JSON.parse(kiwiCli(["hooks", "status", "--json"], env).out) as { hooks: { harness: string; state: string }[] }).hooks.map((r) => [r.harness, r.state]));
  expect(states()).toEqual({ claude: "missing", codex: "missing", gemini: "absent", cursor: "absent", grok: "absent", kimi: "absent", pi: "absent", mimo: "absent", zcode: "absent" });

  expect(kiwiCli(["hooks", "install", "claude"], env).code).toBe(0);
  expect(states().claude).toBe("partial");
  expect(kiwiCli(["hooks", "install", "claude", "--listen"], env).code).toBe(0);
  expect(states().claude).toBe("installed");

  expect(kiwiCli(["hooks", "install", "codex"], env).code).toBe(0);
  expect(states().codex).toBe("installed");
  expect(kiwiCli(["hooks", "uninstall", "codex"], env).code).toBe(0);
  expect(states().codex).toBe("off");

  expect(JSON.parse(kiwiCli(["hooks", "status", "claude", "--json"], env).out)).toEqual({ hooks: [{ harness: "claude", state: "installed", text: "installed" }] });
  expect(kiwiCli(["hooks", "status"], env).out.split("\n").slice(0, 3)).toEqual(["claude: installed", "codex: off", "gemini: not detected"]);
});

test("a harness that passes CLAUDECODE through is never taken for Claude Code by its hooks", () => {
  expect(hooksListen({ CLAUDECODE: "1", MIMOCODE: "1" })).toBe(false);
  expect(rewakeCapable({ CLAUDECODE: "1", MIMOCODE: "1", AI_AGENT: "claude-code_9-9-9_agent" })).toBe(false);
  expect(rewakeCapable({ CLAUDECODE: "1", GROK_SESSION_ID: "g", AI_AGENT: "claude-code_9-9-9_agent" })).toBe(false);
  expect(rewakeCapable({ CLAUDECODE: "1", AI_AGENT: "claude-code_9-9-9_agent" })).toBe(true);
});

const KIMI_USER_CONFIG = `# my Kimi setup
default_model = "kimi-code/k3"

[models."kimi-code/k3"]
provider = "kimi"
model = "k3"

[[hooks]]
event = "Notification"
matcher = "task\\\\.completed"
command = "notify-send done # kiwi"
`;

function kimiStops(path: string): string[] {
  const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as { hooks?: { event: string; command: string }[] };
  return (parsed.hooks ?? []).filter((h) => h.command.endsWith(" hook kimi-stop # kiwi")).map((h) => h.event);
}

const ZCODE_USER = {
  model: "glm-5",
  hooks: { timeoutMs: 20_000, events: { Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit" }] }] } },
};

type ZcodeHook = { type: string; command: string; timeoutMs?: number };
type ZcodeConfig = { model?: string; hooks?: { enabled?: boolean; timeoutMs?: number; events?: Record<string, { matcher?: string; hooks: ZcodeHook[] }[]> } };

function readZcode(path: string): ZcodeConfig {
  return JSON.parse(readFileSync(path, "utf8")) as ZcodeConfig;
}

test("ZCode: one Stop entry in config.json beside the user's hooks, hooks turned on, re-installed once, and uninstall gives the user's file back", () => {
  const dir = scratch("hk-zcode-");
  setEnv({ KIWI_HOME: scratch("hk-zcode-home-"), KIWI_ZCODE_DIR: dir });
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(ZCODE_USER, null, 2) + "\n");
  expect(extraInstalled("zcode")).toBe(false);
  expect(installExtra("zcode")).toBe(path);
  installExtra("zcode");
  const config = readZcode(path);
  expect(config.model).toBe("glm-5");
  expect(config.hooks?.enabled).toBe(true);
  expect(config.hooks?.timeoutMs).toBe(20_000);
  expect(config.hooks?.events?.PreToolUse).toEqual(ZCODE_USER.hooks.events.PreToolUse);
  const stop = config.hooks?.events?.Stop ?? [];
  expect(stop[0]).toEqual(ZCODE_USER.hooks.events.Stop[0]);
  expect(stop.slice(1).flatMap((g) => g.hooks)).toEqual([{ type: "command", command: expect.stringMatching(/ hook stop # kiwi$/), timeoutMs: 30_000 }]);
  expect(extraInstalled("zcode")).toBe(true);
  expect(hooksStatus()).toContain("zcode: installed");
  uninstallExtra("zcode");
  expect(readZcode(path)).toEqual(ZCODE_USER);
  expect(extraInstalled("zcode")).toBe(false);
  expect(loadConfig().zcodeHooksTurnedOn).toBeUndefined();
});

test("ZCode: hooks a person turned on stay on after uninstall, and uninstall without Kiwi's entry changes nothing", () => {
  const dir = scratch("hk-zcode-on-");
  setEnv({ KIWI_HOME: scratch("hk-zcode-on-home-"), KIWI_ZCODE_DIR: dir });
  const path = join(dir, "config.json");
  const theirs = { hooks: { enabled: true } };
  writeFileSync(path, JSON.stringify(theirs));
  uninstallExtra("zcode");
  expect(readZcode(path)).toEqual(theirs);
  installExtra("zcode");
  installExtra("zcode");
  expect(loadConfig().zcodeHooksTurnedOn).toBeUndefined();
  uninstallExtra("zcode");
  expect(readZcode(path)).toEqual(theirs);
  const withEvents = { hooks: { enabled: true, events: { Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }] } } };
  writeFileSync(path, JSON.stringify(withEvents));
  installExtra("zcode");
  uninstallExtra("zcode");
  expect(readZcode(path)).toEqual(withEvents);
});

test("ZCode: a config replaced after Kiwi's install starts its note again, and an uninstall that fails keeps the note for its retry", () => {
  const dir = scratch("hk-zcode-life-");
  setEnv({ KIWI_HOME: scratch("hk-zcode-life-home-"), KIWI_ZCODE_DIR: dir });
  const path = join(dir, "config.json");
  installExtra("zcode");
  expect(loadConfig().zcodeHooksTurnedOn).toEqual([path]);
  const replaced = { hooks: { enabled: true } };
  writeFileSync(path, JSON.stringify(replaced));
  installExtra("zcode");
  expect(loadConfig().zcodeHooksTurnedOn).toBeUndefined();
  uninstallExtra("zcode");
  expect(readZcode(path)).toEqual(replaced);

  rmSync(path);
  installExtra("zcode");
  const installed = readFileSync(path, "utf8");
  writeFileSync(path, "{ not json");
  expect(() => uninstallExtra("zcode")).toThrow();
  expect(loadConfig().zcodeHooksTurnedOn).toEqual([path]);
  writeFileSync(path, installed);
  uninstallExtra("zcode");
  expect(existsSync(path)).toBe(false);
  expect(loadConfig().zcodeHooksTurnedOn).toBeUndefined();
});

test("ZCode: an absent config.json gets just the hook and is absent again after uninstall; hooks a person turned off stay off", () => {
  const dir = scratch("hk-zcode-none-");
  setEnv({ KIWI_HOME: scratch("hk-zcode-none-home-"), KIWI_ZCODE_DIR: dir });
  const path = join(dir, "config.json");
  installExtra("zcode");
  expect(Object.keys(readZcode(path))).toEqual(["hooks"]);
  expect(Object.keys(readZcode(path).hooks?.events ?? {})).toEqual(["Stop"]);
  uninstallExtra("zcode");
  expect(existsSync(path)).toBe(false);
  writeFileSync(path, JSON.stringify({ hooks: { enabled: false } }));
  expect(() => installExtra("zcode")).toThrow("hooks.enabled is false");
  expect(readZcode(path)).toEqual({ hooks: { enabled: false } });
  expect(extraInstalled("zcode")).toBe(false);
});

test("Kimi Code: one Stop entry in config.toml, re-installed once, and uninstall gives the user's file back as it was", () => {
  const kimi = scratch("hk-kimi-");
  setEnv({ KIWI_HOME: scratch("hk-kimi-home-"), KIWI_KIMI_DIR: kimi });
  const path = join(kimi, "config.toml");
  writeFileSync(path, KIMI_USER_CONFIG);
  expect(extraInstalled("kimi")).toBe(false);

  expect(installExtra("kimi")).toBe(path);
  installExtra("kimi");
  expect(kimiStops(path)).toEqual(["Stop"]);
  expect(extraInstalled("kimi")).toBe(true);
  const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as { default_model: string; models: Record<string, { model: string }>; hooks: Record<string, unknown>[] };
  expect(parsed.default_model).toBe("kimi-code/k3");
  expect(parsed.models["kimi-code/k3"]!.model).toBe("k3");
  expect(parsed.hooks[0]).toEqual({ event: "Notification", matcher: "task\\.completed", command: "notify-send done # kiwi" });
  const ours = parsed.hooks[1]!;
  expect(Object.keys(ours).sort()).toEqual(["command", "event", "timeout"]);
  expect(ours.timeout).toBe(30);
  expect(readFileSync(path, "utf8").startsWith(KIMI_USER_CONFIG)).toBe(true);
  expect(hooksStatus()).toContain("kimi: installed");

  uninstallExtra("kimi");
  expect(readFileSync(path, "utf8")).toBe(KIMI_USER_CONFIG);
  expect(extraInstalled("kimi")).toBe(false);
  uninstallExtra("kimi");
  expect(readFileSync(path, "utf8")).toBe(KIMI_USER_CONFIG);
});

test("Kimi Code: a Stop entry with the user's tables after it is replaced in place of nothing they wrote", () => {
  const ours = withKimiHooks("");
  expect(ours).toStartWith('[[hooks]]\nevent = "Stop"\ncommand = ');
  expect(ours).toEndWith(' hook kimi-stop # kiwi"\ntimeout = 30\n');
  const later = `${ours}\n# mine\n[mcp]\nservers = ["a"]\n`;
  const stripped = withoutKimiHooks(later);
  expect(stripped).not.toContain("kimi-stop");
  expect(stripped).toContain('# mine\n[mcp]\nservers = ["a"]');
  const again = withKimiHooks(later);
  expect(again.match(/kimi-stop/g)).toHaveLength(1);
  expect(Bun.TOML.parse(again)).toMatchObject({ mcp: { servers: ["a"] } });
});

test("Kimi Code: a config kiwi can't edit safely is left as it was", () => {
  const kimi = scratch("hk-kimi-odd-");
  setEnv({ KIWI_HOME: scratch("hk-kimi-odd-home-"), KIWI_KIMI_DIR: kimi });
  const path = join(kimi, "config.toml");
  const odd = `[hooks]\nenabled = true\n`;
  writeFileSync(path, odd);
  expect(() => installExtra("kimi")).toThrow("can't edit");
  expect(readFileSync(path, "utf8")).toBe(odd);
  writeFileSync(path, "default_model = ");
  expect(() => installExtra("kimi")).toThrow("can't edit");
  expect(readFileSync(path, "utf8")).toBe("default_model = ");
});

test("Kimi Code: an absent config.toml gets just the Stop entry, and is absent again after uninstall", () => {
  const kimi = join(scratch("hk-kimi-new-"), "nested");
  setEnv({ KIWI_HOME: scratch("hk-kimi-new-home-"), KIWI_KIMI_DIR: kimi });
  installExtra("kimi");
  expect(kimiStops(join(kimi, "config.toml"))).toEqual(["Stop"]);
  uninstallExtra("kimi");
  expect(existsSync(join(kimi, "config.toml"))).toBe(false);
  uninstallExtra("kimi");
  expect(existsSync(join(kimi, "config.toml"))).toBe(false);
});

test("Grok's Stop input: a monitor is the listener when it runs this seat's listen, or the daemon hears the seat from this session", () => {
  expect(backgroundTasks(undefined)).toBeNull();
  expect(backgroundTasks("x")).toBeNull();
  const tasks = backgroundTasks([
    { id: "1", type: "shell", status: "running", command: "kiwi listen" },
    { id: "2", type: "monitor", status: "running", description: "tail -f build.log" },
    { id: "3", type: "subagent", status: "running", description: "review", agentType: "explore" },
    "junk",
  ]);
  expect(tasks).toEqual([
    { type: "shell", text: "kiwi listen" },
    { type: "monitor", text: "tail -f build.log" },
    { type: "subagent", text: "review" },
  ]);
  const seat = ["kiwi listen", "kiwi -c ch --as g listen"];
  expect(grokMonitorListens(tasks!, seat)).toBe(false);
  expect(grokMonitorListens([{ type: "monitor", text: " kiwi -c ch --as g listen " }], seat)).toBe(true);
  expect(grokMonitorListens([{ type: "monitor", text: "kiwi listen" }], seat)).toBe(true);
  expect(grokMonitorListens([{ type: "monitor", text: "kiwi -c other --as g listen" }], seat)).toBe(false);
  expect(grokMonitorListens([{ type: "monitor", text: "kiwi listen -c other --as other" }], seat)).toBe(false);
  expect(grokMonitorListens([{ type: "monitor", text: "kiwi listen --now" }], seat)).toBe(false);
  expect(grokMonitorListens([{ type: "monitor", text: "[monitor] kiwi -c ch --as g listen" }], seat)).toBe(true);
  expect(grokMonitorListens([{ type: "monitor", text: "kiwi messages\n[monitor]kiwi listen" }], seat)).toBe(true);
  expect(grokMonitorListens([{ type: "monitor", text: "[monitor] kiwi -c ch --as g listen --once" }], seat)).toBe(false);
  expect(grokMonitorListens([{ type: "monitor", text: "[monitor] kiwi -c other --as g listen" }], seat)).toBe(false);
  expect(grokMonitorListens([{ type: "monitor", text: `[${"x".repeat(40)}] kiwi listen` }], seat)).toBe(false);
  expect(grokMonitorListens([{ type: "shell", text: "kiwi listen" }], seat)).toBe(false);
  expect(grokMonitorListens([], seat)).toBe(false);
});

test("a monitor Grok names only by its display line, `[monitor] …`, is read as that line (issue #785)", () => {
  const tasks = backgroundTasks([
    { id: "d", type: "monitor", status: "running", display_command: "[monitor] kiwi -c ch --as g listen" },
    { id: "e", type: "monitor", status: "running", displayCommand: "[monitor] kiwi listen", description: "kiwi messages" },
  ]);
  expect(tasks).toEqual([
    { type: "monitor", text: "[monitor] kiwi -c ch --as g listen" },
    { type: "monitor", text: "kiwi messages\n[monitor] kiwi listen" },
  ]);
  expect(grokMonitorListens(tasks!.slice(0, 1), ["kiwi -c ch --as g listen"])).toBe(true);
  expect(grokMonitorListens(tasks!.slice(1), ["kiwi listen"])).toBe(true);
});

test("Grok's Stop input names a task's type as kind, as Grok 1.0.62 sends it, and type wins when both are there", () => {
  const tasks = backgroundTasks([
    { id: "a", kind: "monitor", status: "running", command: "kiwi -c ch --as g listen", description: "kiwi messages" },
    { id: "b", kind: "shell", type: "monitor", status: "running", command: "tail -f x" },
    { id: "c", status: "running", command: "no kind" },
  ]);
  expect(tasks).toEqual([
    { type: "monitor", text: "kiwi -c ch --as g listen\nkiwi messages" },
    { type: "monitor", text: "tail -f x" },
  ]);
  expect(tasks).not.toBeNull();
  expect(grokMonitorListens(tasks ?? [], ["kiwi listen", "kiwi -c ch --as g listen"])).toBe(true);
});

const MAIN_TS = join(import.meta.dir, "..", "src", "cli", "main.ts");

function shellQuoted(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function script(path: string, body: string): string {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function kiwiCli(args: string[], env: Record<string, string>): { code: number; out: string } {
  const r = Bun.spawnSync([process.execPath, MAIN_TS, ...args], { cwd: scratch("hk-cli-cwd-"), env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() };
}

test("`kiwi __kiwi-identity` prints this kiwi's version and the file it runs from, and nothing else takes that argument", () => {
  const r = kiwiCli(["__kiwi-identity"], {});
  expect(r.code).toBe(0);
  const line = r.out.trim();
  expect(line.split("\n")).toHaveLength(1);
  expect(line.startsWith(`${VERSION} ${realpathSync(MAIN_TS)} `)).toBe(true);
  expect(kiwiCli(["__kiwi-identity"], {}).out.trim()).toBe(line);
});

test("a hook through a wrapper in kiwi's install folder counts only when the wrapper answers as this kiwi", () => {
  const install = scratch("hk-id-install ' ");
  const elsewhere = scratch("hk-id-else-");
  const claude = scratch("hk-id-claude-");
  const grok = scratch("hk-id-grok-");
  const env = {
    KIWI_HOME: scratch("hk-id-home-"),
    KIWI_INSTALL: install,
    CLAUDE_CONFIG_DIR: claude,
    KIWI_GROK_DIR: grok,
    KIWI_CODEX_DIR: join(elsewhere, "none"),
    KIWI_GEMINI_DIR: join(elsewhere, "none"),
    KIWI_CURSOR_DIR: join(elsewhere, "none"),
    KIWI_KIMI_DIR: join(elsewhere, "none"),
    KIWI_PI_DIR: join(elsewhere, "none"),
    KIWI_MIMO_DIR: join(elsewhere, "none"),
  };
  const forward = (target: string) => `exec ${shellQuoted(process.execPath)} ${shellQuoted(target)} "$@"`;
  const write = (program: string) => {
    const cmd = (arg: string) => `${shellQuoted(program)} hook ${arg} # kiwi`;
    const listen = { hooks: [{ type: "command", command: cmd("listen"), async: true, asyncRewake: true, timeout: 7 * 24 * 3600 + 60 }] };
    writeFileSync(
      join(claude, "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: cmd("session-start") }] }, listen],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd("prompt") }] }, listen],
          Stop: [{ hooks: [{ type: "command", command: cmd("stop") }] }, listen],
          PermissionRequest: [{ matcher: "Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|mcp__.*", hooks: [{ type: "command", command: cmd("permission"), timeout: 1800 }] }],
        },
      }),
    );
    mkdirSync(join(grok, "hooks"), { recursive: true });
    writeFileSync(join(grok, "hooks", "kiwi.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `${shellQuoted(program)} --harness grok hook stop # kiwi` }] }] } }));
  };
  const status = () => {
    const r = kiwiCli(["hooks", "status"], env);
    expect(r.code).toBe(0);
    return r.out.split("\n").filter((l) => l.startsWith("claude:") || l.startsWith("grok:"));
  };

  const wrapper = join(install, "kiwi");
  script(wrapper, forward(MAIN_TS));
  write(wrapper);
  expect(status()).toEqual(["claude: installed", "grok: installed"]);

  const old = script(join(elsewhere, "old-kiwi"), `[ "$1" = "__kiwi-identity" ] && echo "0.0.1 ${elsewhere}/old-kiwi 1:1 1 1"; exit 0`);
  script(wrapper, `exec ${shellQuoted(old)} "$@"`);
  expect(status()).toEqual(["claude: not installed", "grok: not installed"]);

  script(wrapper, `exec ${shellQuoted(join(elsewhere, "missing"))} "$@"`);
  expect(status()).toEqual(["claude: not installed", "grok: not installed"]);

  script(wrapper, forward(MAIN_TS));
  chmodSync(wrapper, 0o644);
  expect(status()).toEqual(["claude: not installed", "grok: not installed"]);

  const outside = script(join(elsewhere, "kiwi"), forward(MAIN_TS));
  write(outside);
  expect(status()).toEqual(["claude: not installed", "grok: not installed"]);
});

function probeWrapper(body: string): { cmd: string; install: string } {
  const install = scratch("hk-probe-install-");
  setEnv({ KIWI_INSTALL: install, KIWI_HOME: scratch("hk-probe-home-") });
  const wrapper = script(join(install, "kiwi"), body);
  return { cmd: `${shellQuoted(wrapper)} hook stop # kiwi`, install };
}

test("a wrapper's answer is asked again after PROBE_TTL_MS, so a target that changed or was repaired is noticed", () => {
  const self = selfIdentity();
  expect(self).not.toBeNull();
  const idFile = join(scratch("hk-probe-id-"), "id");
  writeFileSync(idFile, self ?? "");
  const { cmd } = probeWrapper(`cat ${shellQuoted(idFile)}`);
  try {
    expect(isOurHook(cmd, "stop")).toBe(true);
    writeFileSync(idFile, "0.0.1 another-kiwi 1:1 1 1");
    expect(isOurHook(cmd, "stop")).toBe(true);
    setSystemTime(new Date(Date.now() + PROBE_TTL_MS + 1_000));
    expect(isOurHook(cmd, "stop")).toBe(false);
    writeFileSync(idFile, self ?? "");
    expect(isOurHook(cmd, "stop")).toBe(false);
    setSystemTime(new Date(Date.now() + PROBE_TTL_MS + 1_000));
    expect(isOurHook(cmd, "stop")).toBe(true);
  } finally {
    setSystemTime();
  }
});

test(
  "a wrapper that ignores SIGTERM is cut off at PROBE_MS and doesn't count",
  () => {
    const { cmd } = probeWrapper("trap '' TERM\nsleep 9\necho late");
    const t0 = Date.now();
    expect(isOurHook(cmd, "stop")).toBe(false);
    expect(Date.now() - t0).toBeLessThan(PROBE_MS + 2_000);
  },
  PROBE_MS + 10_000,
);

test(
  "a wrapper that answers and leaves a child holding its output is heard at once",
  () => {
    const dir = scratch("hk-probe-child-");
    const idFile = join(dir, "id");
    const pidFile = join(dir, "pid");
    writeFileSync(idFile, selfIdentity() ?? "");
    const { cmd } = probeWrapper(`sleep 9 &\necho $! > ${shellQuoted(pidFile)}\ncat ${shellQuoted(idFile)}`);
    const t0 = Date.now();
    try {
      expect(isOurHook(cmd, "stop")).toBe(true);
      expect(Date.now() - t0).toBeLessThan(2_000);
    } finally {
      process.kill(Number(readFileSync(pidFile, "utf8").trim()), "SIGKILL");
    }
  },
  PROBE_MS + 10_000,
);

test("the probe runs with a short allowlist of environment variables, not the agent's session or secrets", () => {
  const self = selfIdentity();
  const idFile = join(scratch("hk-probe-env-"), "id");
  writeFileSync(idFile, self ?? "");
  setEnv({ KIWI_TEST_SECRET: "s3cret", CLAUDE_CODE_SESSION_ID: "session-x", GROK_SESSION_ID: "grok-x" });
  const { cmd } = probeWrapper(`[ -z "$KIWI_TEST_SECRET" ] && [ -z "$CLAUDE_CODE_SESSION_ID" ] && [ -z "$GROK_SESSION_ID" ] && [ -n "$PATH" ] && cat ${shellQuoted(idFile)}`);
  expect(isOurHook(cmd, "stop")).toBe(true);
});

test("a Kimi Code Stop reason is the answers' plain text, for stderr", () => {
  expect(
    kimiReason([
      { kind: "block", text: "a" },
      { kind: "block", text: "b" },
    ]),
  ).toBe("a\n\nb");
});

test("a hand-over keeps whole messages up to its size limit, and cuts a single message bigger than the limit", () => {
  expect(fitting(["aaa", "bbb", "ccc"], 7)).toEqual({ count: 2, text: "aaa\nbbb" });
  expect(fitting(["aaa", "bbb"], 7)).toEqual({ count: 2, text: "aaa\nbbb" });
  expect(fitting(["a".repeat(10), "b"], 4)).toEqual({ count: 1, text: "aaaa …" });
  expect(fitting([], 4)).toEqual({ count: 0, text: "" });
});

test("a config.json that isn't JSON leaves every hook exiting 0, with one line naming the file", () => {
  const home = scratch("hk-bad-config-");
  writeFileSync(join(home, "config.json"), "{ not json");
  const env = { KIWI_HOME: home, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "bad", AI_AGENT: "claude-code_2-1-296_agent" };
  for (const event of ["session-start", "prompt", "stop", "listen"]) {
    const r = Bun.spawnSync([process.execPath, MAIN_TS, "hook", event], { cwd: home, env: { ...process.env, ...env }, stdin: new TextEncoder().encode("{}"), stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toBe("");
    expect(r.stderr.toString()).toContain(`${join(home, "config.json")} isn't valid JSON`);
  }
});

test("kiwi hooks install adds a PermissionRequest hook that waits up to 30 minutes, and never a listen hook on it", () => {
  hideEnv(["AI_AGENT", "CLAUDE_CODE_EXECPATH", "CLAUDECODE"]);
  const dir = scratch("kiwi-permission-install-");
  setEnv({ KIWI_HOME: scratch("kiwi-permission-install-home-"), CLAUDE_CONFIG_DIR: dir });
  const file = join(dir, "settings.json");
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" });
  installHooks();
  const s = JSON.parse(readFileSync(file, "utf8")) as HookFile;
  expect((s.hooks.PermissionRequest as { matcher?: string }[]).map((e) => e.matcher)).toEqual(["Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|mcp__.*"]);
  const permission = s.hooks.PermissionRequest!.flatMap((e) => e.hooks);
  expect(permission).toHaveLength(1);
  expect(permission[0]!.command.endsWith(" hook permission # kiwi")).toBe(true);
  expect(permission[0]!.timeout).toBe(1800);
  expect(hooksStatus()).toContain("claude: installed");
  uninstallHooks();
  expect((JSON.parse(readFileSync(file, "utf8")) as Partial<HookFile>).hooks?.PermissionRequest).toBeUndefined();
});

test("a SessionStart migration adds the PermissionRequest hook to hooks from an older kiwi, and leaves a person's own permission hooks alone", () => {
  hideEnv(["AI_AGENT", "CLAUDE_CODE_EXECPATH", "CLAUDECODE"]);
  const dir = scratch("kiwi-permission-migrate-");
  setEnv({ KIWI_HOME: scratch("kiwi-permission-migrate-home-"), CLAUDE_CONFIG_DIR: dir });
  const file = join(dir, "settings.json");
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" });
  installHooks();
  const s = JSON.parse(readFileSync(file, "utf8")) as HookFile;
  s.hooks.PermissionRequest = [{ hooks: [{ command: "echo mine" }] }];
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  expect(hooksStatus()).toContain("claude: not installed");
  expect(migrateClaudeHooks()).toBe(file);
  const after = (JSON.parse(readFileSync(file, "utf8")) as HookFile).hooks.PermissionRequest!.flatMap((e) => e.hooks.map((h) => h.command));
  expect(after[0]).toBe("echo mine");
  expect(after).toHaveLength(2);
  expect(hooksStatus()).toContain("claude: installed");
  expect(migrateClaudeHooks()).toBeNull();
});

test("a PermissionRequest entry with another matcher or timeout is stale: status names it and the migration replaces it, without adding listen hooks that weren't there", () => {
  hideEnv(["AI_AGENT", "CLAUDE_CODE_EXECPATH", "CLAUDECODE"]);
  const dir = scratch("kiwi-permission-stale-");
  setEnv({ KIWI_HOME: scratch("kiwi-permission-stale-home-"), CLAUDE_CONFIG_DIR: dir });
  const file = join(dir, "settings.json");
  installHooks();
  setEnv({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-296_agent" });
  const s = JSON.parse(readFileSync(file, "utf8")) as HookFile;
  expect(listenTimeouts(file)).toEqual({ SessionStart: [], UserPromptSubmit: [], Stop: [], PermissionRequest: [] });
  (s.hooks.PermissionRequest as { matcher?: string; hooks: { timeout?: number }[] }[])[0]!.hooks[0]!.timeout = 600;
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  expect(hooksStatus()).toContain("claude: not installed (the permission prompt hook is missing or from an older kiwi");
  expect(migrateClaudeHooks()).toBe(file);
  const after = JSON.parse(readFileSync(file, "utf8")) as HookFile;
  expect(after.hooks.PermissionRequest!.flatMap((e) => e.hooks.map((h) => h.timeout))).toEqual([1800]);
  expect(listenTimeouts(file)).toEqual({ SessionStart: [], UserPromptSubmit: [], Stop: [], PermissionRequest: [] });
});
