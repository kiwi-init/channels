import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

type Claude = { installHooks: (keepListen?: boolean, addListen?: boolean) => string; uninstallHooks: () => string };
type Extra = { installExtra: (h: string) => string; uninstallExtra: (h: string) => string; extraInstalled: (h: string) => boolean };
type Zcode = { installZcode: (path: string) => void; uninstallZcode: (path: string) => void; zcodeInstalled: (path: string) => boolean };
type Self = { hookCommand: (arg: string, harness?: string) => string };

export type Outcome = { scenario: string; result: string; files: Record<string, string> };

const ENV = ["CLAUDE_CONFIG_DIR", "KIWI_HOME", "KIWI_CODEX_DIR", "KIWI_GEMINI_DIR", "KIWI_GROK_DIR", "KIWI_ZCODE_DIR"] as const;

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

  const scenario = async (name: string, seed: Record<string, string>, act: (dir: string) => unknown): Promise<void> => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-claude-shaped-"));
    const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
    process.env.KIWI_HOME = join(dir, "kiwi");
    process.env.KIWI_CODEX_DIR = join(dir, "codex");
    process.env.KIWI_GEMINI_DIR = join(dir, "gemini");
    process.env.KIWI_GROK_DIR = join(dir, "grok");
    process.env.KIWI_ZCODE_DIR = join(dir, "zcode");
    for (const [path, text] of Object.entries(seed)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    let result: string;
    try {
      const r = await act(dir);
      result = `ok ${JSON.stringify(r ?? null)}`;
    } catch (err) {
      result = `threw ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`;
    }
    const files = filesUnder(dir);
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(dir, { recursive: true, force: true });
    const clean = (s: string) => s.split(dir).join("<DIR>").split(Bun.main).join("<RUNNER>").split(process.execPath).join("<BUN>").split(root).join("<ROOT>");
    outcomes.push({ scenario: name, result: clean(result), files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, clean(v)])) });
  };
  const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
  const mixed = (cmd: string) => ({
    theme: "dark",
    hooks: {
      Stop: [{ hooks: [foreign] }, { hooks: [] }, { matcher: "m", hooks: [{ type: "command", command: cmd }, foreign] }, { hooks: [{ type: "command", command: cmd }] }],
      Other: [{ hooks: [foreign] }],
    },
  });
  const onlyOurs = (cmd: string) => ({ hooks: { Stop: [{ hooks: [{ type: "command", command: cmd }] }] } });

  await scenario("claude install fresh, keeping listen", {}, () => claude.installHooks(true));
  await scenario("claude install over foreign and stale hooks, no listen", { "claude/settings.json": json(mixed(ours("stop"))) }, () => claude.installHooks(false, false));
  await scenario("claude uninstall with no settings file", {}, () => claude.uninstallHooks());
  await scenario("claude uninstall keeps foreign hooks and drops emptied groups", { "claude/settings.json": json(mixed(ours("stop"))) }, () => claude.uninstallHooks());
  await scenario("claude uninstall of only ours", { "claude/settings.json": json(onlyOurs(ours("stop"))) }, () => claude.uninstallHooks());
  await scenario("claude install over a malformed group", { "claude/settings.json": json({ hooks: { Stop: [{ matcher: "m" }] } }) }, () => claude.installHooks(false, false));
  await scenario("claude uninstall over a malformed group", { "claude/settings.json": json({ hooks: { Stop: [{ matcher: "m" }] } }) }, () => claude.uninstallHooks());
  await scenario("claude install over a JSON array", { "claude/settings.json": "[]\n" }, () => claude.installHooks(false, false));
  await scenario("claude uninstall over JSON null", { "claude/settings.json": "null\n" }, () => claude.uninstallHooks());

  await scenario("codex install fresh", {}, () => [extra.installExtra("codex"), extra.extraInstalled("codex")]);
  await scenario("gemini install over foreign hooks", { "gemini/settings.json": json(mixed(ours("stop", "gemini"))) }, () => [extra.installExtra("gemini"), extra.extraInstalled("gemini")]);
  await scenario("grok install fresh", {}, () => [extra.installExtra("grok"), extra.extraInstalled("grok")]);
  await scenario("codex uninstall with no file", {}, () => [extra.uninstallExtra("codex"), extra.extraInstalled("codex")]);
  await scenario("gemini uninstall keeps foreign hooks", { "gemini/settings.json": json(mixed(ours("stop", "gemini"))) }, () => [extra.uninstallExtra("gemini"), extra.extraInstalled("gemini")]);
  await scenario("grok uninstall of only ours removes the file", { "grok/hooks/kiwi.json": json(onlyOurs(ours("stop", "grok"))) }, () => [extra.uninstallExtra("grok"), extra.extraInstalled("grok")]);
  await scenario("codex uninstall of only ours keeps other keys", { "codex/hooks.json": json({ ...onlyOurs(ours("stop", "codex")), version: 2 }) }, () => extra.uninstallExtra("codex"));
  await scenario("codex uninstall over a malformed group", { "codex/hooks.json": json({ hooks: { Stop: [{ matcher: "m" }] } }) }, () => extra.uninstallExtra("codex"));
  await scenario("gemini install over a JSON array", { "gemini/settings.json": "[]\n" }, () => extra.installExtra("gemini"));

  const zpath = (dir: string) => join(dir, "zcode", "config.json");
  const zgroups = (cmd: string) => ({
    other: 1,
    hooks: {
      events: { Stop: ["text", { hooks: [] }, { hooks: [foreign] }, { name: "x", hooks: [{ type: "command", command: cmd }, foreign] }, { hooks: [{ type: "command", command: cmd }] }], Start: [] },
    },
  });
  await scenario("zcode install fresh, then uninstall", {}, (dir) => {
    zcode.installZcode(zpath(dir));
    const on = zcode.zcodeInstalled(zpath(dir));
    zcode.uninstallZcode(zpath(dir));
    return [on, zcode.zcodeInstalled(zpath(dir))];
  });
  await scenario("zcode install and uninstall keep malformed and empty foreign groups", { "zcode/config.json": json(zgroups(ours("stop"))) }, (dir) => {
    zcode.installZcode(zpath(dir));
    const installed = readFileSync(zpath(dir), "utf8");
    zcode.uninstallZcode(zpath(dir));
    return [installed.length > 0, zcode.zcodeInstalled(zpath(dir))];
  });
  await scenario("zcode install refused when hooks are off", { "zcode/config.json": json({ hooks: { enabled: false } }) }, (dir) => zcode.installZcode(zpath(dir)));
  return outcomes;
}

if (import.meta.main) {
  const at = process.argv.indexOf("--root");
  const root = resolve(at > 0 ? (process.argv[at + 1] ?? ".") : join(import.meta.dir, ".."));
  console.log(JSON.stringify(await runScenarios(root), null, 1));
}
