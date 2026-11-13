import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

type Claude = {
  installHooks: (keepListen?: boolean, addListen?: boolean) => string;
  uninstallHooks: () => string;
  claudeHooksStatus: () => string;
  withoutOurs: (entries: unknown) => unknown;
};
type Extra = { installExtra: (h: string) => string; uninstallExtra: (h: string) => string; extraInstalled: (h: string) => boolean };
type Zcode = { installZcode: (path: string) => void; uninstallZcode: (path: string) => void; zcodeInstalled: (path: string) => boolean };
type Self = { hookCommand: (arg: string, harness?: string) => string; LISTEN: string; LISTEN_SECONDS: number; PERMISSION: string };

type Phase = { phase: string; result: string; files: Record<string, string> };
export type Outcome = { scenario: string; phases: Phase[] };
type Step = [string, (dir: string) => unknown];

const ENV = ["CLAUDE_CONFIG_DIR", "KIWI_HOME", "KIWI_CODEX_DIR", "KIWI_GEMINI_DIR", "KIWI_GROK_DIR", "KIWI_ZCODE_DIR", "CLAUDECODE", "AI_AGENT", "CLAUDE_CODE_EXECPATH"] as const;
const OLD_CLAUDE = { CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-200_agent" };
const NEW_CLAUDE = { CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-300_agent" };

function filesUnder(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, "utf8");
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

async function runScenarios(root: string): Promise<Outcome[]> {
  const claude = (await import(join(root, "src/hooks/install/claude.ts"))) as Claude;
  const extra = (await import(join(root, "src/hooks/install/extra.ts"))) as Extra;
  const zcode = (await import(join(root, "src/hooks/install/zcode.ts"))) as Zcode;
  const self = (await import(join(root, "src/hooks/self.ts"))) as Self;
  const ours = (arg: string, harness?: string) => self.hookCommand(arg, harness);
  const foreign = { type: "command", command: "echo someone-else" };
  const outcomes: Outcome[] = [];

  const scenario = async (name: string, seed: Record<string, string>, steps: Step[], env: Record<string, string> = {}): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-claude-shaped-"));
    const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    for (const k of ENV) delete process.env[k];
    Object.assign(process.env, {
      CLAUDE_CONFIG_DIR: join(dir, "claude"),
      KIWI_HOME: join(dir, "kiwi"),
      KIWI_CODEX_DIR: join(dir, "codex"),
      KIWI_GEMINI_DIR: join(dir, "gemini"),
      KIWI_GROK_DIR: join(dir, "grok"),
      KIWI_ZCODE_DIR: join(dir, "zcode"),
      ...env,
    });
    for (const [path, text] of Object.entries(seed)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const clean = (s: string) => s.split(dir).join("<DIR>").split(Bun.main).join("<RUNNER>").split(process.execPath).join("<BUN>").split(root).join("<ROOT>");
    const snapshot = (phase: string, result: string): Phase => ({
      phase,
      result: clean(result),
      files: Object.fromEntries(Object.entries(filesUnder(dir)).map(([k, v]) => [k, clean(v)])),
    });
    const phases: Phase[] = [snapshot("seed", "ok null")];
    for (const [phase, act] of steps) {
      let result: string;
      try {
        result = `ok ${JSON.stringify((await act(dir)) ?? null)}`;
      } catch (err) {
        result = `threw ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`;
      }
      phases.push(snapshot(phase, result));
    }
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(dir, { recursive: true, force: true });
    outcomes.push({ scenario: name, phases });
  };
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const command = (cmd: string, more: Record<string, unknown> = {}) => ({ type: "command", command: cmd, ...more });
  const mixed = (cmd: string) => ({
    theme: "dark",
    hooks: {
      Stop: [{ hooks: [foreign] }, { hooks: [] }, { matcher: "m", hooks: [command(cmd), foreign] }, { hooks: [command(cmd)] }],
      Other: [{ hooks: [foreign] }],
    },
  });
  const onlyOurs = (cmd: string) => ({ hooks: { Stop: [{ hooks: [command(cmd)] }] } });
  const listenEntry = (current: boolean) => ({
    hooks: [command(ours(self.LISTEN), current ? { async: true, asyncRewake: true, timeout: self.LISTEN_SECONDS + 60 } : { async: true, timeout: 60 })],
  });
  const withListen = (current: boolean) => ({
    hooks: {
      SessionStart: [{ hooks: [command(ours("session-start"))] }, listenEntry(current)],
      UserPromptSubmit: [{ hooks: [command(ours("prompt"))] }, listenEntry(current)],
      Stop: [{ hooks: [command(ours("stop"))] }, listenEntry(current), { hooks: [foreign] }],
      PermissionRequest: [{ matcher: "Bash", hooks: [command(ours(self.PERMISSION), { timeout: 60 })] }],
    },
  });
  const settings = "claude/settings.json";
  const claudeCycle: Step[] = [
    ["install", () => [claude.installHooks(), claude.claudeHooksStatus()]],
    ["reinstall", () => [claude.installHooks(), claude.claudeHooksStatus()]],
    ["uninstall", () => [claude.uninstallHooks(), claude.claudeHooksStatus()]],
  ];

  await scenario("claude default install, reinstall, uninstall; version unknown", {}, claudeCycle);
  await scenario("claude default install, reinstall, uninstall; Claude 2.1.200", {}, claudeCycle, OLD_CLAUDE);
  await scenario("claude default install, reinstall, uninstall; Claude 2.1.300", {}, claudeCycle, NEW_CLAUDE);
  await scenario("claude default install over stale listen and permission; version unknown", { [settings]: json(withListen(false)) }, claudeCycle);
  await scenario("claude default install over current listen; version unknown", { [settings]: json(withListen(true)) }, claudeCycle);
  await scenario("claude default install over current listen; Claude 2.1.200", { [settings]: json(withListen(true)) }, claudeCycle, OLD_CLAUDE);
  await scenario("claude default install over stale listen and permission; Claude 2.1.300", { [settings]: json(withListen(false)) }, claudeCycle, NEW_CLAUDE);
  await scenario("claude install keeping listen, then without", {}, [
    ["install keeping listen", () => claude.installHooks(true)],
    ["install without listen", () => claude.installHooks(false, false)],
  ]);
  await scenario("claude install over foreign and stale hooks, no listen", { [settings]: json(mixed(ours("stop"))) }, [
    ["install", () => claude.installHooks(false, false)],
    ["uninstall", () => claude.uninstallHooks()],
  ]);
  await scenario("claude uninstall keeps foreign hooks and drops emptied groups", { [settings]: json(mixed(ours("stop"))) }, [["uninstall", () => claude.uninstallHooks()]]);
  await scenario("claude uninstall with no settings file", {}, [["uninstall", () => claude.uninstallHooks()]]);
  await scenario("claude uninstall of only ours", { [settings]: json(onlyOurs(ours("stop"))) }, [["uninstall", () => claude.uninstallHooks()]]);
  await scenario("claude over a malformed group", { [settings]: json({ hooks: { Stop: [{ matcher: "m" }] } }) }, [
    ["install", () => claude.installHooks(false, false)],
    ["uninstall", () => claude.uninstallHooks()],
  ]);
  await scenario("claude install over a JSON array", { [settings]: "[]\n" }, [["install", () => claude.installHooks(false, false)]]);
  await scenario("claude uninstall over JSON null", { [settings]: "null\n" }, [["uninstall", () => claude.uninstallHooks()]]);
  await scenario("claude.ts withoutOurs", {}, [
    ["filter", () => claude.withoutOurs([{ hooks: [foreign] }, { hooks: [] }, { matcher: "m", hooks: [command(ours("stop")), foreign] }, { hooks: [command(ours("stop"))] }])],
    ["undefined", () => claude.withoutOurs(undefined)],
    ["malformed", () => claude.withoutOurs([{ matcher: "m" }])],
  ]);

  for (const h of ["codex", "gemini", "grok"]) {
    await scenario(`${h} install, reinstall, uninstall, uninstall again`, {}, [
      ["install", () => [extra.installExtra(h), extra.extraInstalled(h)]],
      ["reinstall", () => [extra.installExtra(h), extra.extraInstalled(h)]],
      ["uninstall", () => [extra.uninstallExtra(h), extra.extraInstalled(h)]],
      ["uninstall again", () => [extra.uninstallExtra(h), extra.extraInstalled(h)]],
    ]);
  }
  await scenario("gemini over foreign hooks", { "gemini/settings.json": json(mixed(ours("stop", "gemini"))) }, [
    ["install", () => [extra.installExtra("gemini"), extra.extraInstalled("gemini")]],
    ["uninstall", () => [extra.uninstallExtra("gemini"), extra.extraInstalled("gemini")]],
  ]);
  await scenario("grok uninstall of only ours removes the file", { "grok/hooks/kiwi.json": json(onlyOurs(ours("stop", "grok"))) }, [
    ["uninstall", () => [extra.uninstallExtra("grok"), extra.extraInstalled("grok")]],
  ]);
  await scenario("codex uninstall of only ours keeps other keys", { "codex/hooks.json": json({ ...onlyOurs(ours("stop", "codex")), version: 2 }) }, [
    ["uninstall", () => extra.uninstallExtra("codex")],
  ]);
  await scenario("codex over a malformed group", { "codex/hooks.json": json({ hooks: { Stop: [{ matcher: "m" }] } }) }, [
    ["install", () => extra.installExtra("codex")],
    ["uninstall", () => extra.uninstallExtra("codex")],
  ]);
  await scenario("gemini over a JSON array", { "gemini/settings.json": "[]\n" }, [
    ["install", () => extra.installExtra("gemini")],
    ["uninstall", () => extra.uninstallExtra("gemini")],
  ]);

  const zpath = (dir: string) => join(dir, "zcode", "config.json");
  const zcycle: Step[] = [
    ["install", (dir) => [zcode.installZcode(zpath(dir)), zcode.zcodeInstalled(zpath(dir))]],
    ["reinstall", (dir) => [zcode.installZcode(zpath(dir)), zcode.zcodeInstalled(zpath(dir))]],
    ["uninstall", (dir) => [zcode.uninstallZcode(zpath(dir)), zcode.zcodeInstalled(zpath(dir))]],
    ["uninstall again", (dir) => [zcode.uninstallZcode(zpath(dir)), zcode.zcodeInstalled(zpath(dir))]],
  ];
  const zconfig = (hooks: Record<string, unknown>) => ({ "zcode/config.json": json({ other: 1, hooks }) });
  const zgroups = (cmd: string) => ({ Stop: ["text", { hooks: [] }, { hooks: [foreign] }, { name: "x", hooks: [command(cmd), foreign] }, { hooks: [command(cmd)] }], Start: [] });
  await scenario("zcode with no config file", {}, zcycle);
  await scenario("zcode with hooks enabled", zconfig({ enabled: true, events: { Start: [{ hooks: [foreign] }] } }), zcycle);
  await scenario("zcode with hooks enabled unset", zconfig({ events: { Start: [{ hooks: [foreign] }] } }), zcycle);
  await scenario("zcode with hooks disabled", zconfig({ enabled: false }), zcycle);
  await scenario("zcode keeps malformed and empty foreign groups", zconfig({ events: zgroups(ours("stop")) }), zcycle);
  return outcomes;
}

if (import.meta.main) {
  const at = process.argv.indexOf("--root");
  const root = resolve(at > 0 ? (process.argv[at + 1] ?? ".") : join(import.meta.dir, ".."));
  console.log(JSON.stringify(await runScenarios(root), null, 1));
}
