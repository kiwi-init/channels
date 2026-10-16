// Per-harness hook files: write, idempotent re-install, uninstall leaves the user's own entries.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/config.ts";
import { autoInstallExtraHooks, autoInstallHooks, backgroundTasks, cursorStopFollowup, extraInstalled, grokMonitorListens, hooksListen, hooksStatus, installDetected, installExtra, installHooks, kimiReason, rewakeCapable, stopStyle, uninstallDetected, uninstallExtra, withKimiHooks, withoutKimiHooks } from "../src/hooks.ts";

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

const SESSION_ENVS = ["CODEX_THREAD_ID", "GEMINI_CLI", "CURSOR_AGENT", "GROK_SESSION_ID", "GROK_AGENT", "KIWI_NO_HOOKS", "CLAUDECODE"];

afterEach(() => {
  for (const [k, v] of prev) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  prev.clear();
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made.length = 0;
});

function read(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
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
  for (const key of ["KIWI_CODEX_DIR", "KIWI_GEMINI_DIR", "KIWI_CURSOR_DIR", "KIWI_GROK_DIR", "KIWI_KIMI_DIR", "CLAUDE_CONFIG_DIR"]) {
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
        Stop: [{ hooks: [{ type: "command", command: "echo mine # kiwi" }, { type: "command", command: "'/old/kiwi' hook stop # channel-one" }] }],
      },
    }),
  );
  writeFileSync(
    join(gemini, "settings.json"),
    JSON.stringify({ theme: "dark", hooks: { BeforeAgent: [{ matcher: "startup", hooks: [{ type: "command", command: "echo gemini-user" }] }] } }),
  );
  writeFileSync(
    join(cursor, "hooks.json"),
    JSON.stringify({ version: 1, hooks: { stop: [{ command: "echo cursor-user # kiwi" }], preToolUse: [{ command: "echo tool" }] } }),
  );
  mkdirSync(join(grok, "hooks"), { recursive: true });
  writeFileSync(
    join(grok, "hooks", "kiwi.json"),
    JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "echo grok-user" }] }] } }),
  );

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
  expect(read(join(codex, "hooks.json")).hooks.UserPromptSubmit).toBeDefined();
  expect(read(join(codex, "hooks.json")).hooks.SessionStart).toBeDefined();

  const gem = read(join(gemini, "settings.json"));
  expect(gem.theme).toBe("dark");
  const before = gem.hooks.BeforeAgent.flatMap((e: { hooks: { command: string; timeout?: number }[] }) => e.hooks);
  expect(before.map((h: { command: string }) => h.command)).toContain("echo gemini-user");
  expect(before.filter((h: { command: string }) => h.command.endsWith(" hook prompt # kiwi"))).toHaveLength(1);
  expect(before.find((h: { command: string }) => h.command.endsWith(" hook prompt # kiwi")).timeout).toBe(20_000);
  expect(gem.hooks.AfterAgent[0].matcher).toBe("*");
  expect(gem.hooks.AfterAgent[0].hooks[0].timeout).toBe(30_000);
  expect(gem.hooks.UserPromptSubmit).toBeUndefined();

  const cur = read(join(cursor, "hooks.json"));
  expect(cur.version).toBe(1);
  const curStop = cur.hooks.stop.map((h: { command: string; loop_limit?: number }) => h);
  expect(curStop.map((h: { command: string }) => h.command)).toContain("echo cursor-user # kiwi");
  expect(curStop.filter((h: { command: string }) => h.command.endsWith(" hook stop # kiwi"))).toHaveLength(1);
  expect(curStop.find((h: { command: string }) => h.command.endsWith(" hook stop # kiwi")).loop_limit).toBe(5);
  expect(cur.hooks.preToolUse).toEqual([{ command: "echo tool" }]);
  expect(cur.hooks.sessionStart.some((h: { command: string }) => h.command.endsWith(" hook session-start # kiwi"))).toBe(true);

  const claudeStop = read(join(claude, "settings.json")).hooks.Stop.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
  const grokStop = read(join(grok, "hooks", "kiwi.json")).hooks.Stop.flatMap((e: { hooks: { command: string }[] }) => e.hooks.map((h) => h.command));
  const ours = (list: string[]) => list.find((c) => c.endsWith(" hook stop # kiwi"));
  expect(ours(grokStop)).toBe(ours(claudeStop));
  expect(read(join(grok, "hooks", "kiwi.json")).hooks.PostToolUse[0].hooks[0].command).toBe("echo grok-user");
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
  const curLeft = read(join(cursor, "hooks.json"));
  expect(curLeft.version).toBe(1);
  expect(curLeft.hooks.stop).toEqual([{ command: "echo cursor-user # kiwi" }]);
  expect(curLeft.hooks.preToolUse).toEqual([{ command: "echo tool" }]);
  expect(curLeft.hooks.sessionStart).toBeUndefined();
  expect(read(join(grok, "hooks", "kiwi.json")).hooks.PostToolUse[0].hooks[0].command).toBe("echo grok-user");
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
  const unread = cursorStopFollowup(mc, true);
  expect(unread).toBe(`Unread Kiwi messages. Run \`${mc} read\`, answer with \`${mc} reply N "…"\`, then continue.`);
  expect(unread!.length).toBeLessThan(180);
  expect(unread).not.toContain("\n");
  expect(cursorStopFollowup(mc, false)).toBeNull();
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
  expect(ours).toStartWith("[[hooks]]\nevent = \"Stop\"\ncommand = ");
  expect(ours).toEndWith(" hook kimi-stop # kiwi\"\ntimeout = 30\n");
  const later = `${ours}\n# mine\n[mcp]\nservers = ["a"]\n`;
  const stripped = withoutKimiHooks(later);
  expect(stripped).not.toContain("kimi-stop");
  expect(stripped).toContain("# mine\n[mcp]\nservers = [\"a\"]");
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
  expect(grokMonitorListens([{ type: "shell", text: "kiwi listen" }], seat)).toBe(false);
  expect(grokMonitorListens([], seat)).toBe(false);
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

const HOOKS_TS = join(import.meta.dir, "..", "src", "hooks.ts");

function inHome(home: string, script: string, env: Record<string, string> = {}): unknown {
  const r = Bun.spawnSync(["bun", "-e", `import * as h from ${JSON.stringify(HOOKS_TS)};\n${script}`], { env: { ...process.env, HOME: home, ...env }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return JSON.parse(r.stdout.toString());
}

function shellQuoted(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function standardWrapper(home: string): { bin: string; real: string } {
  mkdirSync(join(home, ".kiwi", "bin"), { recursive: true });
  const real = join(home, ".kiwi", "bin", "kiwi.real");
  writeFileSync(real, "#!/bin/sh\nexit 0\n");
  chmodSync(real, 0o755);
  const bin = join(home, ".kiwi", "bin", "kiwi");
  writeFileSync(bin, `#!/bin/sh\nexec ${shellQuoted(real)} "$@"\n`);
  chmodSync(bin, 0o755);
  return { bin, real };
}

test("kiwi's hook is the command this kiwi writes, or the same command for the standard install path when that path runs", () => {
  const home = scratch("hk-ours-home ' ");
  const dir = scratch("hk-ours-");
  const bin = join(home, ".kiwi", "bin", "kiwi");
  const cmd = (program: string, arg: string) => `${shellQuoted(program)} hook ${arg} # kiwi`;
  const check = (commands: [unknown, string][]) => inHome(home, `console.log(JSON.stringify(${JSON.stringify(commands)}.map(([c, a]) => h.isOurHook(c, a))));`);

  expect(check([[cmd(bin, "listen"), "listen"]])).toEqual([false]);
  const { real } = standardWrapper(home);
  expect(Bun.spawnSync([bin, "hook", "stop"]).exitCode).toBe(0);
  const exe = (p: string) => {
    writeFileSync(p, "#!/bin/sh\nexit 0\n");
    chmodSync(p, 0o755);
    return p;
  };
  const elsewhere = exe(join(dir, "kiwi"));
  const echo = exe(join(dir, "echo"));
  const bun = exe(join(dir, "bun"));
  mkdirSync(join(dir, "src", "cli"), { recursive: true });
  const main = join(dir, "src", "cli", "main.ts");
  writeFileSync(main, "");
  expect(
    check([
      [cmd(bin, "listen"), "listen"],
      [cmd(bin, "kimi-stop"), "kimi-stop"],
      [cmd(bin, "stop"), "listen"],
      [cmd(bin, "kimi-stop"), "stop"],
      [`${shellQuoted(bin)}oops hook stop # kiwi`, "stop"],
      [`${shellQuoted(bin)} extra hook stop # kiwi`, "stop"],
      [`${shellQuoted(bin)} hook stop`, "stop"],
      ["kiwi hook stop # kiwi", "stop"],
      [cmd(real, "stop"), "stop"],
      [cmd(elsewhere, "stop"), "stop"],
      [cmd(echo, "stop"), "stop"],
      [`${shellQuoted(bun)} ${shellQuoted(main)} hook stop # kiwi`, "stop"],
      [`${shellQuoted(echo)} ${shellQuoted(main)} hook stop # kiwi`, "stop"],
      [undefined, "stop"],
    ]),
  ).toEqual([true, true, false, false, false, false, false, false, false, false, false, false, false, false]);

  chmodSync(bin, 0o644);
  expect(check([[cmd(bin, "stop"), "stop"]])).toEqual([false]);
  rmSync(bin);
  mkdirSync(bin);
  expect(check([[cmd(bin, "stop"), "stop"]])).toEqual([false]);
});

test("Claude Code's and Grok's hooks count as installed through a wrapper at the standard path, and not once it's gone", () => {
  const home = scratch("hk-wrap-home-");
  const claude = scratch("hk-wrap-claude-");
  const grok = scratch("hk-wrap-grok-");
  const elsewhere = scratch("hk-wrap-else-");
  const { bin } = standardWrapper(home);
  const other = join(elsewhere, "kiwi");
  writeFileSync(other, "#!/bin/sh\nexit 0\n");
  chmodSync(other, 0o755);
  const write = (program: string) => {
    const cmd = (arg: string) => `${shellQuoted(program)} hook ${arg} # kiwi`;
    const listen = { hooks: [{ type: "command", command: cmd("listen"), async: true, asyncRewake: true }] };
    writeFileSync(
      join(claude, "settings.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: cmd("session-start") }] }, listen],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: cmd("prompt") }] }, listen],
          Stop: [{ hooks: [{ type: "command", command: cmd("stop") }] }, listen],
        },
      }),
    );
    mkdirSync(join(grok, "hooks"), { recursive: true });
    writeFileSync(join(grok, "hooks", "kiwi.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: cmd("stop") }] }] } }));
  };
  const installed = () =>
    inHome(home, `console.log(JSON.stringify([h.listenHooksInstalled(), h.extraInstalled("grok")]));`, { KIWI_HOME: scratch("hk-wrap-kiwi-"), CLAUDE_CONFIG_DIR: claude, KIWI_GROK_DIR: grok });
  write(bin);
  expect(installed()).toEqual([true, true]);
  write(other);
  expect(installed()).toEqual([false, false]);
  write(bin);
  rmSync(bin);
  expect(installed()).toEqual([false, false]);
});

test("a Kimi Code Stop reason is the answers' plain text, for stderr", () => {
  expect(kimiReason([{ kind: "block", text: "a" }, { kind: "block", text: "b" }])).toBe("a\n\nb");
});
