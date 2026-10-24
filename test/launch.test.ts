import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readLaunch } from "@kiwi/core/membership.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { launchAgent } from "../src/launch/launch.ts";
import type { PlaceTools } from "../src/terminals/plugin.ts";
import { joinLineRefusal } from "@kiwi/core/join-line.ts";
import { choicesRefusal, contextWords, readContext } from "@kiwi/core/launch-options.ts";
import { canStart, joinPrompt, launchChoicesRefusal, recipeArgv } from "../src/launch/recipes.ts";
import { readLaunched } from "@kiwi/core/terminals.ts";
import { launchedText, readLaunchRequest } from "../src/launch/wire.ts";
import { startRelay } from "../src/relay/bun.ts";
import { setupChannel } from "./owner.ts";

setDefaultTimeout(30_000);

const root = mkdtempSync(join(tmpdir(), "kiwi-launch-"));
const code = "mc2-AAAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBBBBBBBB";
const prevHome = process.env.KIWI_HOME;
const prevNoHooks = process.env.KIWI_NO_HOOKS;
process.env.KIWI_HOME = join(root, "home");

afterAll(() => {
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  if (prevNoHooks === undefined) delete process.env.KIWI_NO_HOOKS;
  else process.env.KIWI_NO_HOOKS = prevNoHooks;
  rmSync(root, { recursive: true, force: true });
});

function script(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("the line an agent is started with", () => {
  test("takes only a join code, an http(s) relay, a plain nickname and an invite's token", () => {
    expect(joinLineRefusal({ code })).toBeNull();
    expect(joinLineRefusal({ code, relay: "https://relay.example", nick: "Ada Bot", persona: "eyJhIjoxfQ" })).toBeNull();
    expect(joinLineRefusal({ code: "mc2-nope" })).toContain("join code");
    expect(joinLineRefusal({ code: `${code}; rm -rf ~` })).toContain("join code");
    for (const relay of ["ftp://relay.example", "https://relay.example/x", "https://relay.example'; curl x"]) expect(joinLineRefusal({ code, relay })).toContain("relay");
    for (const nick of ["it's", "a;b", " lead", "x".repeat(41), "$(id)", "a\nb"]) expect(joinLineRefusal({ code, nick })).toContain("nickname");
    expect(joinLineRefusal({ code, persona: "not a token" })).toContain("personality");
    expect(joinLineRefusal({ code, persona: "a".repeat(801) })).toContain("personality");
  });

  test("is one kiwi join command, the nickname quoted", () => {
    const prompt = joinPrompt({ code, relay: "https://relay.example", nick: "Ada Bot", persona: "eyJhIjoxfQ" });
    expect(prompt).toContain(`kiwi join ${code} --relay https://relay.example --nick 'Ada Bot' --persona eyJhIjoxfQ.`);
    expect(prompt).not.toContain("\n");
    expect(joinPrompt({ code })).toContain(`kiwi join ${code}. If it asks for your model, run it again with --model`);
  });

  test("Claude Code and Codex start with it as their first prompt; the others wait for their own recipe", () => {
    expect(recipeArgv("claude", "/bin/claude", "P")).toEqual(["/bin/claude", "--allowedTools", "Bash(kiwi join:*)", "--", "P"]);
    expect(recipeArgv("codex", "/bin/codex", "P")).toEqual(["/bin/codex", "--", "P"]);
    for (const h of ["gemini", "cursor", "grok", "opencode", "kimi", "mimo", "pi"] as const) {
      expect(canStart(h)).toBe(false);
      expect(recipeArgv(h, "/bin/x", "P")).toBeNull();
    }
  });

  test("Claude Code gets the model, effort, permission mode and 1M context as its own flags", () => {
    const join = ["--allowedTools", "Bash(kiwi join:*)", "--", "P"];
    expect(recipeArgv("claude", "/bin/claude", "P", { model: "opus", effort: "high", permission: "bypass", context: 1_000_000 })).toEqual([
      "/bin/claude",
      "--model",
      "opus[1m]",
      "--effort",
      "high",
      "--permission-mode",
      "bypassPermissions",
      ...join,
    ]);
    expect(recipeArgv("claude", "/bin/claude", "P", { permission: "accept-edits" })).toEqual(["/bin/claude", "--permission-mode", "acceptEdits", ...join]);
    expect(recipeArgv("claude", "/bin/claude", "P", { permission: "plan" })).toEqual(["/bin/claude", "--permission-mode", "plan", ...join]);
    expect(recipeArgv("claude", "/bin/claude", "P", { permission: "default", model: "claude-opus-5-5" })).toEqual(["/bin/claude", "--model", "claude-opus-5-5", ...join]);
  });

  test("Codex gets the model, effort, context window and sandbox and approval flags, or the bypass one", () => {
    expect(recipeArgv("codex", "/bin/codex", "P", { model: "gpt-5.3-codex", effort: "xhigh", permission: "plan", context: 400_000 })).toEqual([
      "/bin/codex",
      "-m",
      "gpt-5.3-codex",
      "-c",
      'model_reasoning_effort="xhigh"',
      "-c",
      "model_context_window=400000",
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "on-request",
      "--",
      "P",
    ]);
    expect(recipeArgv("codex", "/bin/codex", "P", { permission: "accept-edits" })).toEqual(["/bin/codex", "--sandbox", "workspace-write", "--ask-for-approval", "on-request", "--", "P"]);
    expect(recipeArgv("codex", "/bin/codex", "P", { permission: "bypass" })).toEqual(["/bin/codex", "--dangerously-bypass-approvals-and-sandbox", "--", "P"]);
    expect(recipeArgv("codex", "/bin/codex", "P", { permission: "default" })).toEqual(["/bin/codex", "--", "P"]);
  });

  test("each harness takes only the efforts, permissions and context sizes it knows", () => {
    expect(launchChoicesRefusal("claude", { model: "opus", effort: "max", permission: "bypass", context: 1_000_000 })).toBeNull();
    expect(launchChoicesRefusal("codex", { model: "o3", effort: "minimal", permission: "plan", context: 272_000 })).toBeNull();
    expect(launchChoicesRefusal("claude", { effort: "minimal" })).toBe("Claude Code takes effort low, medium, high, xhigh, max, not minimal");
    expect(launchChoicesRefusal("codex", { effort: "max" })).toBe("Codex takes effort minimal, low, medium, high, xhigh, not max");
    expect(launchChoicesRefusal("claude", { model: "opus", context: 400_000 })).toBe("Claude Code takes context 1m, not 400k");
    expect(launchChoicesRefusal("codex", { context: 300_000 })).toBe("Codex takes context 128k, 272k, 400k, 1m, not 300k");
    expect(launchChoicesRefusal("claude", { context: 1_000_000 })).toContain("needs an Opus, Sonnet or Fable model");
    expect(launchChoicesRefusal("claude", { model: "haiku", context: 1_000_000 })).toContain("needs an Opus, Sonnet or Fable model");
    expect(launchChoicesRefusal("claude", { model: "claude-sonnet-5-5", context: 1_000_000 })).toBeNull();
    const bare = { model: false, effort: [], permission: [], context: [] };
    expect([
      choicesRefusal("Mo", bare, { model: "m" }),
      choicesRefusal("Mo", bare, { effort: "high" }),
      choicesRefusal("Mo", bare, { permission: "plan" }),
      choicesRefusal("Mo", bare, { context: 1_000_000 }),
    ]).toEqual(["Mo doesn't take a model from Kiwi", "Mo doesn't take an effort level from Kiwi", "Mo doesn't take a permission mode from Kiwi", "Mo doesn't take a context size from Kiwi"]);
  });

  test("kiwi launch reads --context as 1m, 400k or a token count, and stops at a choice it can't read before reaching the daemon", async () => {
    expect([readContext("1m"), readContext("400K"), readContext("272000"), readContext("1.5m"), readContext("12"), readContext("lots")]).toEqual([1_000_000, 400_000, 272_000, null, null, null]);
    expect([1_000_000, 400_000, 272_500].map(contextWords)).toEqual(["1m", "400k", "272500"]);
    for (const bad of [
      ["--permission", "yolo"],
      ["--context", "huge"],
      ["--model", "opus --permission-mode bypassPermissions"],
    ]) {
      const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "launch", "claude", "--code", code, ...bad], {
        env: { ...process.env, KIWI_HOME: join(root, "cli-home") },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await p.exited).not.toBe(0);
      expect(await new Response(p.stderr).text()).toContain("usage: kiwi launch HARNESS");
    }
    expect(existsSync(daemonSock(join(root, "cli-home")))).toBe(false);
  });

  test("a choice is a known word or a plain model id, never an extra argument", () => {
    const base = { harness: "claude", folder: "/w", code };
    expect(readLaunchRequest({ ...base, model: "us.anthropic.claude-opus-5-5-v1:0", effort: "high", permission: "plan", context: 1_000_000 })).toEqual({
      harness: "claude",
      folder: "/w",
      code,
      model: "us.anthropic.claude-opus-5-5-v1:0",
      effort: "high",
      permission: "plan",
      context: 1_000_000,
    });
    for (const bad of [
      { model: "--dangerously-skip-permissions" },
      { model: "opus --permission-mode bypassPermissions" },
      { model: "$(id)" },
      { model: "" },
      { effort: "high; rm -rf ~" },
      { effort: "HIGH" },
      { permission: "yolo" },
      { permission: "bypassPermissions" },
      { context: "1m" },
      { context: 12 },
      { context: 1.5e6 + 0.5 },
    ]) {
      expect(readLaunchRequest({ ...base, ...bad })).toBeNull();
    }
  });
});

describe("launching an agent", () => {
  const bins = join(root, "bins");
  const folder = join(root, "project");
  const calls = join(root, "tmux-calls");
  let tools: PlaceTools;

  beforeAll(() => {
    mkdirSync(folder, { recursive: true });
    script(bins, "claude", "echo '2.1.304 (Claude Code)'");
    script(bins, "codex", "echo 'codex-cli 0.163.0'");
    const tmux = script(
      join(root, "tools"),
      "tmux",
      `for a in "$@"; do printf '%s\\n' "$a" >> '${calls}'; done
printf '%s\\n' --- >> '${calls}'
printf '/tmp/sock\\tkiwi\\t@7\\t%%9\\t4242\\n'`,
    );
    tools = { platform: "linux", shell: "/bin/sh", rex: null, tmux, osascript: null };
  });

  const launched = () => readFileSync(calls, "utf8").split("---\n").at(-2)?.split("\n") ?? [];

  test("refuses what isn't a project folder, a harness without a recipe, and one that isn't installed", async () => {
    const PATH = `${bins}:/usr/bin:/bin`;
    expect(await launchAgent({ harness: "claude", folder: "relative", code }, { PATH, tools })).toMatchObject({ ok: false, why: "bad-request" });
    expect(await launchAgent({ harness: "claude", folder: join(root, "missing"), code }, { PATH, tools })).toMatchObject({ ok: false, why: "bad-request" });
    expect(await launchAgent({ harness: "claude", folder: homedir(), code }, { PATH, tools })).toMatchObject({ ok: false, why: "bad-request", detail: expect.stringContaining("home folder") });
    expect(await launchAgent({ harness: "claude", folder: "/", code }, { PATH, tools })).toMatchObject({ ok: false, why: "bad-request" });
    expect(await launchAgent({ harness: "claude", folder, code: "nope" }, { PATH, tools })).toMatchObject({ ok: false, why: "bad-request" });
    expect(await launchAgent({ harness: "gemini", folder, code }, { PATH, tools })).toMatchObject({ ok: false, why: "no-recipe" });
    expect(await launchAgent({ harness: "claude", folder, code }, { PATH: "/usr/bin:/bin", tools })).toMatchObject({ ok: false, why: "not-installed" });
    expect(existsSync(calls)).toBe(false);
  });

  test("starts the harness the inventory found, in the folder, with its join line and a launch id the owner can read", async () => {
    process.env.KIWI_NO_HOOKS = "1";
    const r = await launchAgent({ harness: "claude", folder, code, nick: "Ada Bot", persona: "eyJhIjoxfQ" }, { PATH: `${bins}:/usr/bin:/bin`, tools });
    expect(r).toMatchObject({ ok: true, placed: { ok: true, place: "tmux", session: "kiwi", window: "@7", pane: "%9", pid: 4242 } });
    if (!r.ok) throw new Error(r.detail);
    expect(readLaunch(r.launch)).toBe(r.launch);
    const argv = launched();
    expect(argv.slice(argv.indexOf("-c"), argv.indexOf("-c") + 4)).toEqual(["-c", folder, "-n", "Ada Bot"]);
    expect(argv).toContain(`KIWI_LAUNCH=${r.launch}`);
    expect(argv).toContain(`KIWI_HOME=${join(root, "home")}`);
    expect(argv).toContain(join(bins, "claude"));
    expect(argv.slice(-5, -1)).toEqual(["--allowedTools", "Bash(kiwi join:*)", "--", expect.stringContaining(`kiwi join ${code} --nick 'Ada Bot' --persona eyJhIjoxfQ`)]);
    const again = await launchAgent({ harness: "codex", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, tools });
    expect(again.ok && again.launch !== r.launch).toBe(true);
    expect(await launchAgent({ harness: "codex", folder, code, launch: "fromTheApp_0123456789" }, { PATH: `${bins}:/usr/bin:/bin`, tools })).toMatchObject({
      ok: true,
      launch: "fromTheApp_0123456789",
    });
    expect(launched()).toContain("KIWI_LAUNCH=fromTheApp_0123456789");
    expect(launched()).toContain(join(bins, "codex"));
    expect(launched()).toContain("codex");
  });

  test("starts it with the choices it was asked for, and refuses one its harness doesn't take before anything opens", async () => {
    process.env.KIWI_NO_HOOKS = "1";
    const PATH = `${bins}:/usr/bin:/bin`;
    expect(await launchAgent({ harness: "claude", folder, code, model: "sonnet", effort: "xhigh", permission: "plan", context: 1_000_000 }, { PATH, tools })).toMatchObject({ ok: true });
    expect(launched().slice(-11, -1)).toEqual([
      "--model",
      "sonnet[1m]",
      "--effort",
      "xhigh",
      "--permission-mode",
      "plan",
      "--allowedTools",
      "Bash(kiwi join:*)",
      "--",
      expect.stringContaining(`kiwi join ${code}`),
    ]);
    expect(await launchAgent({ harness: "codex", folder, code, permission: "bypass", context: 128_000 }, { PATH, tools })).toMatchObject({ ok: true });
    expect(launched().slice(-6, -1)).toEqual(["-c", "model_context_window=128000", "--dangerously-bypass-approvals-and-sandbox", "--", expect.stringContaining(`kiwi join ${code}`)]);
    const before = readFileSync(calls, "utf8");
    expect(await launchAgent({ harness: "codex", folder, code, effort: "max" }, { PATH, tools })).toEqual({
      ok: false,
      why: "bad-request",
      detail: "Codex takes effort minimal, low, medium, high, xhigh, not max",
    });
    expect(await launchAgent({ harness: "claude", folder, code, context: 1_000_000 }, { PATH, tools })).toMatchObject({ ok: false, why: "bad-request" });
    expect(readFileSync(calls, "utf8")).toBe(before);
  });

  test("puts the harness's hooks in before it starts, unless they're off", async () => {
    delete process.env.KIWI_NO_HOOKS;
    const claudeSettings = join(process.env.CLAUDE_CONFIG_DIR!, "settings.json");
    const codexHooks = join(process.env.KIWI_CODEX_DIR!, "hooks.json");
    rmSync(claudeSettings, { force: true });
    rmSync(codexHooks, { force: true });
    await launchAgent({ harness: "claude", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, tools });
    expect(readFileSync(claudeSettings, "utf8")).toContain("kiwi");
    expect(readFileSync(claudeSettings, "utf8")).toContain("listen");
    await launchAgent({ harness: "codex", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, tools });
    expect(readFileSync(codexHooks, "utf8")).toContain("kiwi");
    rmSync(codexHooks, { force: true });
    mkdirSync(process.env.KIWI_HOME!, { recursive: true });
    writeFileSync(join(process.env.KIWI_HOME!, "config.json"), JSON.stringify({ channels: {}, harnessHooks: { codex: "off" } }));
    expect(await launchAgent({ harness: "codex", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, tools })).toMatchObject({ ok: true });
    expect(existsSync(codexHooks)).toBe(false);
  });

  test("the daemon's answer reads back as it was sent, and says where the agent is", async () => {
    const r = await launchAgent({ harness: "claude", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, tools });
    expect(readLaunched(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(launchedText(r)).toMatch(/^started in tmux window @7 of session kiwi \(tmux attach -t kiwi\); it joins with launch [A-Za-z0-9_-]{22}$/);
    expect(readLaunched({ ok: false, why: "no-place", detail: "install tmux" })).toEqual({ ok: false, why: "no-place", detail: "install tmux" });
    expect(readLaunched({ ok: false, why: "exploded" })).toEqual({ ok: false, why: "failed", detail: "" });
    expect(readLaunched({ ok: true, launch: "x", placed: { ok: true, place: "moon" } })).toBeNull();
    expect(readLaunchRequest({ harness: "claude", folder, code, nick: "Ada", relay: 3 })).toEqual({ harness: "claude", folder, code, nick: "Ada" });
    expect(readLaunchRequest({ harness: "grok-bot", folder, code })).toBeNull();
    expect(readLaunchRequest({ harness: "claude", folder, code, launch: "fromTheApp_0123456789" })).toEqual({ harness: "claude", folder, code, launch: "fromTheApp_0123456789" });
    expect(readLaunchRequest({ harness: "claude", folder, code, launch: "short" })).toBeNull();
    expect(readLaunchRequest({ harness: "claude", folder, code, launch: "has spaces in it" })).toBeNull();
    expect(readLaunchRequest({ harness: "claude", code })).toBeNull();
  });
});

describe("kiwi join started by a launch", () => {
  const dataDir = join(root, "relay");
  let server: ReturnType<typeof startRelay>;

  beforeAll(() => {
    server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  });

  afterAll(async () => {
    await stopDaemon(daemonSock(join(root, "joiner")));
    server.stop(true);
  });

  test("carries KIWI_LAUNCH to the owner in its sealed claims, and drops one that isn't an id", async () => {
    const s = await setupChannel(server.url.origin);
    const ask = async (launch: string, as: string) => {
      const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "join", s.code, "--as", as, "--timeout", "1s"], {
        env: { ...process.env, KIWI_HOME: join(root, "joiner"), KIWI_RELAY: s.relay, KIWI_LAUNCH: launch, KIWI_NO_HOOKS: "1" },
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      await p.exited;
      return (await s.ownerCh.requests()).find((r) => r.name === as);
    };
    expect((await ask("abcDEF123_-xyz0123456", "launched"))?.launch).toBe("abcDEF123_-xyz0123456");
    expect((await ask("no good; id", "forged"))?.launch).toBeUndefined();
  });
});
