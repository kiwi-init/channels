import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readLaunch } from "@kiwi/core/membership.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { launchAgent } from "../src/launch/launch.ts";
import type { Hosted } from "../src/launch/place.ts";
import type { Pane, PlaceRequest } from "../src/terminals/plugin.ts";
import { tmuxPane } from "../src/terminals/tmux/type.ts";
import { HostedTmux } from "../src/daemon/hosted-tmux.ts";
import { typeWhenReady, type Typed } from "../src/launch/typed.ts";
import { kimiScreen } from "../src/loop/kimi.ts";
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
  test("takes only a join code, an https relay (http only on this computer), a plain nickname and an invite's token", () => {
    expect(joinLineRefusal({ code })).toBeNull();
    expect(joinLineRefusal({ code, relay: "https://relay.example", nick: "Ada Bot", persona: "eyJhIjoxfQ" })).toBeNull();
    for (const relay of ["http://127.0.0.1:8787", "http://localhost:8787/", "https://relay.example:8443"]) expect(joinLineRefusal({ code, relay })).toBeNull();
    expect(joinLineRefusal({ code: "mc2-nope" })).toContain("join code");
    expect(joinLineRefusal({ code: `${code}; rm -rf ~` })).toContain("join code");
    for (const relay of ["ftp://relay.example", "https://relay.example/x", "https://relay.example'; curl x", "http://relay.example", "http://192.168.1.5:8787", "http://localhost.evil.example"])
      expect(joinLineRefusal({ code, relay })).toContain("relay");
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

  test("Claude Code, Codex, Grok, MiMoCode and OpenCode start with it as their first prompt; the others wait for their own recipe", () => {
    expect(recipeArgv("claude", "/bin/claude", "P")).toEqual(["/bin/claude", "--allowedTools", "Bash(kiwi join:*)", "--", "P"]);
    expect(recipeArgv("codex", "/bin/codex", "P")).toEqual(["/bin/codex", "--", "P"]);
    expect(recipeArgv("grok", "/bin/grok", "P")).toEqual(["/bin/grok", "--", "P"]);
    expect(recipeArgv("mimo", "/bin/mimo", "P", { model: "xiaomi/mimo-v2.5-pro" })).toEqual(["/bin/mimo", "-m", "xiaomi/mimo-v2.5-pro", "--prompt", "P"]);
    expect(recipeArgv("kimi", "/bin/kimi", "P")).toEqual(["/bin/kimi"]);
    expect(recipeArgv("gemini", "/bin/gemini", "P")).toEqual(["/bin/gemini", "-i", "P"]);
    expect(recipeArgv("pi", "/bin/pi", "P")).toEqual(["/bin/pi", "P"]);
    expect(recipeArgv("opencode", "/bin/opencode", "P")).toEqual(["/bin/opencode", "--prompt", "P"]);
    for (const h of ["cursor"] as const) {
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

  test("Grok gets the model, reasoning effort and Claude Code's permission modes", () => {
    expect(recipeArgv("grok", "/bin/grok", "P", { model: "grok-4.7", effort: "xhigh", permission: "accept-edits" })).toEqual([
      "/bin/grok",
      "-m",
      "grok-4.7",
      "--reasoning-effort",
      "xhigh",
      "--permission-mode",
      "acceptEdits",
      "--",
      "P",
    ]);
    expect(recipeArgv("grok", "/bin/grok", "P", { permission: "plan" })).toEqual(["/bin/grok", "--permission-mode", "plan", "--", "P"]);
    expect(recipeArgv("grok", "/bin/grok", "P", { permission: "bypass" })).toEqual(["/bin/grok", "--permission-mode", "bypassPermissions", "--", "P"]);
    expect(recipeArgv("grok", "/bin/grok", "P", { permission: "default" })).toEqual(["/bin/grok", "--", "P"]);
  });

  test("Gemini CLI gets the model and its approval mode, with the join line as its first interactive prompt", () => {
    expect(recipeArgv("gemini", "/bin/gemini", "P", { model: "gemini-2.5-pro", permission: "accept-edits" })).toEqual([
      "/bin/gemini",
      "-m",
      "gemini-2.5-pro",
      "--approval-mode",
      "auto_edit",
      "-i",
      "P",
    ]);
    expect(recipeArgv("gemini", "/bin/gemini", "P", { permission: "plan" })).toEqual(["/bin/gemini", "--approval-mode", "plan", "-i", "P"]);
    expect(recipeArgv("gemini", "/bin/gemini", "P", { permission: "bypass" })).toEqual(["/bin/gemini", "--approval-mode", "yolo", "-i", "P"]);
    expect(recipeArgv("gemini", "/bin/gemini", "P", { permission: "default" })).toEqual(["/bin/gemini", "-i", "P"]);
    expect(launchChoicesRefusal("gemini", { effort: "high" })).toBe("Gemini CLI doesn't take an effort level from Kiwi");
    expect(launchChoicesRefusal("gemini", { context: 1_000_000 })).toBe("Gemini CLI doesn't take a context size from Kiwi");
  });

  test("Pi gets the model and its thinking level, with the join line as its first message, and no permission modes", () => {
    expect(recipeArgv("pi", "/bin/pi", "P", { model: "anthropic/claude-opus-5-5", effort: "xhigh" })).toEqual(["/bin/pi", "--model", "anthropic/claude-opus-5-5", "--thinking", "xhigh", "P"]);
    expect(recipeArgv("pi", "/bin/pi", "P", { effort: "off" })).toEqual(["/bin/pi", "--thinking", "off", "P"]);
    expect(launchChoicesRefusal("pi", { effort: "max" })).toBe("Pi takes effort off, minimal, low, medium, high, xhigh, not max");
    expect(launchChoicesRefusal("pi", { permission: "bypass" })).toBe("Pi doesn't take a permission mode from Kiwi");
    expect(launchChoicesRefusal("pi", { context: 1_000_000 })).toBe("Pi doesn't take a context size from Kiwi");
  });

  test("MiMoCode gets the model, its plan agent, or the flag that skips its permission prompts", () => {
    const m = { model: "xiaomi/mimo-v2.5-pro" };
    expect(recipeArgv("mimo", "/bin/mimo", "P", { ...m, permission: "plan" })).toEqual(["/bin/mimo", "-m", m.model, "--agent", "plan", "--prompt", "P"]);
    expect(recipeArgv("mimo", "/bin/mimo", "P", { ...m, permission: "bypass" })).toEqual(["/bin/mimo", "-m", m.model, "--dangerously-skip-permissions", "--prompt", "P"]);
    expect(recipeArgv("mimo", "/bin/mimo", "P", { ...m, permission: "default" })).toEqual(["/bin/mimo", "-m", m.model, "--prompt", "P"]);
    const oc = { model: "anthropic/claude-sonnet-4" };
    expect(recipeArgv("opencode", "/bin/opencode", "P", { permission: "bypass" })).toEqual(["/bin/opencode", "--auto", "--prompt", "P"]);
    expect(recipeArgv("opencode", "/bin/opencode", "P", { permission: "default" })).toEqual(["/bin/opencode", "--prompt", "P"]);
    expect(recipeArgv("opencode", "/bin/opencode", "P", oc)).toEqual(["/bin/opencode", "mini", "--model", oc.model, "--prompt", "P"]);
    expect(recipeArgv("opencode", "/bin/opencode", "P", { ...oc, permission: "plan" })).toEqual(["/bin/opencode", "mini", "--model", oc.model, "--agent", "plan", "--prompt", "P"]);
    expect(recipeArgv("opencode", "/bin/opencode", "P", { permission: "plan" })).toEqual(["/bin/opencode", "mini", "--agent", "plan", "--prompt", "P"]);
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
    expect(launchChoicesRefusal("grok", { model: "grok-4.7", effort: "none", permission: "bypass" })).toBeNull();
    expect(launchChoicesRefusal("grok", { context: 1_000_000 })).toBe("Grok doesn't take a context size from Kiwi");
    expect(launchChoicesRefusal("mimo", { model: "xiaomi/mimo-v2.5-pro", permission: "plan" })).toBeNull();
    expect(launchChoicesRefusal("mimo", { effort: "high" })).toBe("MiMoCode doesn't take an effort level from Kiwi");
    expect(launchChoicesRefusal("mimo", { permission: "accept-edits" })).toBe("MiMoCode takes permission default, plan, bypass, not accept-edits");
    expect(launchChoicesRefusal("opencode", { model: "anthropic/claude-sonnet-4", permission: "plan" })).toBeNull();
    expect(launchChoicesRefusal("opencode", { permission: "accept-edits" })).toBe("OpenCode takes permission default, plan, bypass, not accept-edits");
    expect(launchChoicesRefusal("opencode", { effort: "high" })).toBe("OpenCode doesn't take an effort level from Kiwi");
    expect(launchChoicesRefusal("opencode", { model: "anthropic/claude-sonnet-4", permission: "bypass" })).toContain("leave the model empty to start it with Bypass");
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
  const opened: PlaceRequest[] = [];
  const hosted: Hosted = {
    ready: async () => null,
    open: async (req) => {
      opened.push(req);
      return { ok: true, place: "hosted", socket: "/tmp/kiwi-1/abc", window: "@7", pane: "%9", pid: 4242 };
    },
    pane: () => null,
  };

  beforeAll(() => {
    mkdirSync(folder, { recursive: true });
    script(bins, "claude", "echo '2.1.304 (Claude Code)'");
    script(bins, "codex", "echo 'codex-cli 0.163.0'");
  });

  const launched = (): string[] => {
    const req = opened.at(-1);
    return req ? ["-c", req.folder, "-n", req.name, ...Object.entries(req.env ?? {}).map(([k, v]) => `${k}=${v}`), ...req.argv] : [];
  };

  test("refuses what isn't a project folder, a harness without a recipe, and one that isn't installed", async () => {
    const PATH = `${bins}:/usr/bin:/bin`;
    expect(await launchAgent({ harness: "claude", folder: "relative", code }, { PATH, hosted })).toMatchObject({ ok: false, why: "bad-request" });
    expect(await launchAgent({ harness: "claude", folder: join(root, "missing"), code }, { PATH, hosted })).toMatchObject({ ok: false, why: "bad-request" });
    expect(await launchAgent({ harness: "claude", folder: homedir(), code }, { PATH, hosted })).toMatchObject({ ok: false, why: "bad-request", detail: expect.stringContaining("home folder") });
    expect(await launchAgent({ harness: "claude", folder: "/", code }, { PATH, hosted })).toMatchObject({ ok: false, why: "bad-request" });
    expect(await launchAgent({ harness: "claude", folder, code: "nope" }, { PATH, hosted })).toMatchObject({ ok: false, why: "bad-request" });
    expect(await launchAgent({ harness: "cursor", folder, code }, { PATH, hosted })).toMatchObject({ ok: false, why: "no-recipe" });
    expect(await launchAgent({ harness: "claude", folder, code }, { PATH: "/usr/bin:/bin", hosted })).toMatchObject({ ok: false, why: "not-installed" });
    expect(opened).toEqual([]);
  });

  test("starts the harness the inventory found, in the folder, with its join line and a launch id the owner can read", async () => {
    process.env.KIWI_NO_HOOKS = "1";
    const r = await launchAgent({ harness: "claude", folder, code, nick: "Ada Bot", persona: "eyJhIjoxfQ" }, { PATH: `${bins}:/usr/bin:/bin`, hosted });
    expect(r).toMatchObject({ ok: true, placed: { ok: true, place: "hosted", window: "@7", pane: "%9", pid: 4242 } });
    if (!r.ok) throw new Error(r.detail);
    expect(readLaunch(r.launch)).toBe(r.launch);
    const argv = launched();
    expect(argv.slice(argv.indexOf("-c"), argv.indexOf("-c") + 4)).toEqual(["-c", folder, "-n", "Ada Bot"]);
    expect(argv).toContain(`KIWI_LAUNCH=${r.launch}`);
    expect(argv).toContain(`KIWI_HOME=${join(root, "home")}`);
    expect(argv).toContain(join(bins, "claude"));
    expect(argv.slice(-4)).toEqual(["--allowedTools", "Bash(kiwi join:*)", "--", expect.stringContaining(`kiwi join ${code} --nick 'Ada Bot' --persona eyJhIjoxfQ`)]);
    const again = await launchAgent({ harness: "codex", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, hosted });
    expect(again.ok && again.launch !== r.launch).toBe(true);
    expect(await launchAgent({ harness: "codex", folder, code, launch: "fromTheApp_0123456789" }, { PATH: `${bins}:/usr/bin:/bin`, hosted })).toMatchObject({
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
    expect(await launchAgent({ harness: "claude", folder, code, model: "sonnet", effort: "xhigh", permission: "plan", context: 1_000_000 }, { PATH, hosted })).toMatchObject({ ok: true });
    expect(launched().slice(-10)).toEqual([
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
    expect(await launchAgent({ harness: "codex", folder, code, permission: "bypass", context: 128_000 }, { PATH, hosted })).toMatchObject({ ok: true });
    expect(launched().slice(-5)).toEqual(["-c", "model_context_window=128000", "--dangerously-bypass-approvals-and-sandbox", "--", expect.stringContaining(`kiwi join ${code}`)]);
    const before = opened.length;
    expect(await launchAgent({ harness: "codex", folder, code, effort: "max" }, { PATH, hosted })).toEqual({
      ok: false,
      why: "bad-request",
      detail: "Codex takes effort minimal, low, medium, high, xhigh, not max",
    });
    expect(await launchAgent({ harness: "claude", folder, code, context: 1_000_000 }, { PATH, hosted })).toMatchObject({ ok: false, why: "bad-request" });
    expect(opened.length).toBe(before);
  });

  test("puts the harness's hooks in before it starts, unless they're off", async () => {
    delete process.env.KIWI_NO_HOOKS;
    const claudeSettings = join(process.env.CLAUDE_CONFIG_DIR!, "settings.json");
    const codexHooks = join(process.env.KIWI_CODEX_DIR!, "hooks.json");
    rmSync(claudeSettings, { force: true });
    rmSync(codexHooks, { force: true });
    await launchAgent({ harness: "claude", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, hosted });
    expect(readFileSync(claudeSettings, "utf8")).toContain("kiwi");
    expect(readFileSync(claudeSettings, "utf8")).toContain("listen");
    await launchAgent({ harness: "codex", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, hosted });
    expect(readFileSync(codexHooks, "utf8")).toContain("kiwi");
    rmSync(codexHooks, { force: true });
    mkdirSync(process.env.KIWI_HOME!, { recursive: true });
    writeFileSync(join(process.env.KIWI_HOME!, "config.json"), JSON.stringify({ channels: {}, harnessHooks: { codex: "off" } }));
    expect(await launchAgent({ harness: "codex", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, hosted })).toMatchObject({ ok: true });
    expect(existsSync(codexHooks)).toBe(false);
  });

  test("the daemon's answer reads back as it was sent, and says where the agent is", async () => {
    const r = await launchAgent({ harness: "claude", folder, code }, { PATH: `${bins}:/usr/bin:/bin`, hosted });
    expect(readLaunched(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(launchedText(r)).toMatch(/^started in Channels' own tmux, window @7 \(to watch it: \S+ -S \/tmp\/kiwi-1\/abc attach -t _kiwi\); it joins with launch [A-Za-z0-9_-]{22}$/);
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

describe("starting Kimi Code, whose first prompt is typed into its window", () => {
  const READY = "Welcome to Kimi Code. No session yet: one will be created on your first message";
  const pane = (screens: (string | null)[]) => {
    const did: string[] = [];
    const p: Pane = {
      screen: () => (screens.length > 1 ? screens.shift()! : (screens[0] ?? null)),
      type: (text) => (did.push(`type ${text}`), true),
      enter: () => (did.push("enter"), true),
      erase: () => true,
    };
    return { p, did };
  };

  test("its model and Ask When Needed, plan or Never Ask modes are its own flags, with no prompt on the command line", () => {
    expect(recipeArgv("kimi", "/bin/kimi", "P", { model: "kimi-k3", permission: "accept-edits" })).toEqual(["/bin/kimi", "-m", "kimi-k3", "--yolo"]);
    expect(recipeArgv("kimi", "/bin/kimi", "P", { permission: "plan" })).toEqual(["/bin/kimi", "--plan"]);
    expect(recipeArgv("kimi", "/bin/kimi", "P", { permission: "bypass" })).toEqual(["/bin/kimi", "--auto"]);
    expect(recipeArgv("kimi", "/bin/kimi", "P", { permission: "default" })).toEqual(["/bin/kimi"]);
    expect(launchChoicesRefusal("kimi", { effort: "high" })).toBe("Kimi Code doesn't take an effort level from Kiwi");
  });

  test("the prompt goes in once its ready screen shows, colours and all, and waits while it asks to trust the folder", async () => {
    const { p, did } = pane([null, "starting…", "\x1b[1mTrust this folder?\x1b[0m", "\x1b[2mone will be created\x1b[0m on your \x1b]8;;x\x07first\x1b]8;;\x07 message"]);
    expect(await typeWhenReady(p, "kiwi join line", kimiScreen, { everyMs: 1 })).toBe("typed");
    expect(did).toEqual(["type kiwi join line", "enter"]);
  });

  test("gives up when the ready screen never shows, or the folder's trust is never answered", async () => {
    let clock = 0;
    const now = () => (clock += 1_000);
    const never = pane(["Signing in…"]);
    expect(await typeWhenReady(never.p, "x", kimiScreen, { everyMs: 1, startingMs: 5_000, now })).toBe("late");
    expect(never.did).toEqual([]);
    clock = 0;
    const asking = pane(["Trust this folder?"]);
    expect(await typeWhenReady(asking.p, "x", kimiScreen, { everyMs: 1, startingMs: 5_000, trustMs: 20_000, now })).toBe("late");
    expect(clock).toBeGreaterThan(20_000);
    expect(asking.did).toEqual([]);
  });

  test("opens in Channels' own tmux and types the join line in once it's ready", async () => {
    const dir = join(root, "kimi");
    const calls = join(dir, "calls");
    const bins = join(dir, "bins");
    script(bins, "kimi-code", "echo 'kimi-code 2.3.1'");
    const tmux = script(
      join(dir, "tools"),
      "tmux",
      `for a in "$@"; do printf '%s\\n' "$a" >> '${calls}'; done
printf '%s\\n' --- >> '${calls}'
case " $* " in
  *" capture-pane "*) printf '%s\\n' '${READY}' ;;
esac`,
    );
    const folder = join(dir, "project");
    mkdirSync(folder, { recursive: true });
    process.env.KIWI_NO_HOOKS = "1";
    const opened: PlaceRequest[] = [];
    const typed = Promise.withResolvers<Typed>();
    const hosted: Hosted = {
      ready: async () => null,
      open: async (req) => {
        opened.push(req);
        return { ok: true, place: "hosted", socket: "/tmp/kiwi-1/abc", window: "@3", pane: "%3" };
      },
      pane: (pane) => tmuxPane({ socket: "/tmp/kiwi-1/abc", pane }, tmux),
    };
    const r = await launchAgent(
      { harness: "kimi", folder, code, nick: "Kim", permission: "plan" },
      { PATH: `${bins}:/usr/bin:/bin`, config: {}, hosted, typing: { everyMs: 5 }, onTyped: (t) => typed.resolve(t) },
    );
    expect(r).toMatchObject({ ok: true, placed: { place: "hosted", pane: "%3" } });
    expect(await typed.promise).toBe("typed");
    expect(opened[0]?.argv).toEqual([join(bins, "kimi-code"), "--plan"]);
    const runs = readFileSync(calls, "utf8")
      .split("---\n")
      .map((c) => c.split("\n").filter(Boolean));
    const set = runs.find((c) => c.includes("set-buffer"))!;
    expect(set.slice(0, 3)).toEqual(["-u", "-S", "/tmp/kiwi-1/abc"]);
    expect(set.at(-1)).toContain(`kiwi join ${code} --nick 'Kim'`);
    expect(runs.find((c) => c.includes("paste-buffer"))).toEqual(expect.arrayContaining(["-p", "-t", "%3"]));
    expect(runs.find((c) => c.includes("send-keys"))).toEqual(["-u", "-S", "/tmp/kiwi-1/abc", "send-keys", "-t", "%3", "Enter"]);
  });
});

describe("an agent that stops as it starts", () => {
  const dir = join(root, "dies");
  const bins = join(dir, "bins");
  const folder = join(dir, "project");
  const log = (): string[] =>
    existsSync(join(root, "home", "launch.log"))
      ? readFileSync(join(root, "home", "launch.log"), "utf8")
          .trim()
          .split("\n")
      : [];
  const said = "The current directory no longer exists (it was deleted or moved). Start Claude Code from an existing directory.";

  beforeAll(() => {
    mkdirSync(folder, { recursive: true });
    mkdirSync(join(root, "home"), { recursive: true });
    script(bins, "claude", `if [ "$1" = "--version" ]; then echo '2.1.304 (Claude Code)'; exit 0; fi\necho '${said}'\nexit 1`);
    process.env.KIWI_NO_HOOKS = "1";
  });

  test("isn't reported started: the launch fails with its exit and last lines, and says so in launch.log", async () => {
    let checks = 0;
    const hosted: Hosted = {
      ready: async () => null,
      open: async () => ({ ok: true, place: "hosted", socket: "/tmp/kiwi-1/abc", window: "@4", pane: "%4" }),
      pane: () => null,
      ended: async () => (++checks < 3 ? null : { code: 1, tail: ["shell-init: error retrieving current directory", said] }),
    };
    const r = await launchAgent({ harness: "claude", folder, code, nick: "lead", launch: "diesAtStart_0123456789" }, { PATH: `${bins}:/usr/bin:/bin`, hosted, watch: { everyMs: 5 } });
    expect(r).toEqual({ ok: false, why: "failed", detail: `Claude Code stopped as it started (exit 1):\nshell-init: error retrieving current directory\n${said}` });
    expect(log().at(-1)).toMatch(
      new RegExp(`\\tdiesAtStart_0123456789\\tclaude\\tnot started: Claude Code stopped as it started \\(exit 1\\): shell-init: .* Start Claude Code from an existing directory\\.$`),
    );
  });

  test("one that keeps running is started once its start window passes, and a stop after that still lands in launch.log", async () => {
    let up = true;
    const hosted: Hosted = {
      ready: async () => null,
      open: async () => ({ ok: true, place: "hosted", socket: "/tmp/kiwi-1/abc", window: "@5", pane: "%5" }),
      pane: () => null,
      ended: async () => (up ? null : { code: 2, tail: ["Not logged in"] }),
    };
    const r = await launchAgent({ harness: "claude", folder, code, launch: "staysUp_0123456789ab" }, { PATH: `${bins}:/usr/bin:/bin`, hosted, watch: { startMs: 30, everyMs: 5, watchMs: 5_000 } });
    expect(r).toMatchObject({ ok: true, launch: "staysUp_0123456789ab" });
    expect(log().at(-1)).toEndWith(`\tstaysUp_0123456789ab\tclaude\tstarted in ${folder}, window @5`);
    up = false;
    for (let i = 0; i < 50 && !log().at(-1)?.includes("stopped"); i++) await Bun.sleep(50);
    expect(log().at(-1)).toMatch(/\tstaysUp_0123456789ab\tclaude\tstopped \d+s after it started, exit 2: Not logged in$/);
  });

  test.if(process.platform !== "win32" && !!Bun.which("tmux"))("in Channels' own tmux, the dead pane's exit and words come back", async () => {
    mkdirSync(join(dir, "tmux-home"), { recursive: true });
    const hosted = new HostedTmux(join(dir, "tmux-home"));
    try {
      const r = await launchAgent({ harness: "claude", folder, code, nick: "lead" }, { PATH: `${bins}:/usr/bin:/bin`, hosted, config: {} });
      expect(r).toMatchObject({ ok: false, why: "failed" });
      if (r.ok) return;
      expect(r.detail.split("\n")).toEqual(["Claude Code stopped as it started (exit 1):", said]);
    } finally {
      await hosted.kill();
    }
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
