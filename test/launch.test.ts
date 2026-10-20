import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readLaunch } from "@kiwi/core/membership.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { launchAgent } from "../src/launch/launch.ts";
import type { PlaceTools } from "../src/launch/place.ts";
import { canStart, joinLineRefusal, joinPrompt, recipeArgv } from "../src/launch/recipes.ts";
import { launchedText, readLaunched, readLaunchRequest } from "../src/launch/wire.ts";
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
    expect(recipeArgv("codex", "/bin/codex", "P")).toEqual(["/bin/codex", "P"]);
    for (const h of ["gemini", "cursor", "grok", "opencode", "kimi", "mimo", "pi"] as const) {
      expect(canStart(h)).toBe(false);
      expect(recipeArgv(h, "/bin/x", "P")).toBeNull();
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
    expect(readLaunched({ ok: false, why: "exploded" })).toBeNull();
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
