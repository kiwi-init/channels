// The model an agent runs on, read from its harness's own files (src/harness.ts), and the card a
// join request carries to the owner (cleanCard): only the model is read, and only a card's fields pass.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectModel } from "../src/card.ts";
import { harnessActivity, harnessModel } from "../src/harness.ts";
import { cleanActivity, cleanCard } from "@kiwi/core/protocol.ts";

const dir = () => mkdtempSync(join(tmpdir(), "kiwi-harness-"));

describe("harnessModel", () => {
  test("Claude Code: the newest real model in the session's transcript, past placeholders", async () => {
    const home = dir();
    mkdirSync(join(home, "projects", "-work-repo"), { recursive: true });
    const lines = [
      { type: "user", message: { content: "do the thing" } },
      { type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "text", text: "secret words" }] } },
      { type: "assistant", message: { model: "<synthetic>", content: [] } },
    ];
    writeFileSync(join(home, "projects", "-work-repo", "s-1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    expect(await harnessModel({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s-1", CLAUDE_CONFIG_DIR: home })).toBe("claude-opus-5-5");
  });

  test("Claude Code: the session from its process's registry when the id isn't in the environment", async () => {
    const home = dir();
    mkdirSync(join(home, "projects", "p"), { recursive: true });
    mkdirSync(join(home, "sessions"));
    writeFileSync(join(home, "sessions", "4242.json"), JSON.stringify({ pid: 4242, sessionId: "s-2", status: "busy" }));
    writeFileSync(join(home, "projects", "p", "s-2.jsonl"), JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5-5" } }) + "\n");
    expect(await harnessModel({ CLAUDECODE: "1", CLAUDE_PID: "4242", CLAUDE_CONFIG_DIR: home })).toBe("claude-sonnet-5-5");
  });

  test("Codex: the thread's model in the newest state index", async () => {
    const home = dir();
    for (const [file, model] of [
      ["state_4.sqlite", "gpt-old"],
      ["state_5.sqlite", "gpt-5-codex"],
    ] as const) {
      const db = new Database(join(home, file));
      db.run("CREATE TABLE threads (id TEXT, model TEXT)");
      db.run("INSERT INTO threads VALUES ('t-1', ?)", [model]);
      db.close();
    }
    expect(await harnessModel({ CODEX_THREAD_ID: "t-1", CODEX_HOME: home })).toBe("gpt-5-codex");
  });

  test("OpenCode: the session's model id", async () => {
    const data = dir();
    mkdirSync(join(data, "opencode"));
    const db = new Database(join(data, "opencode", "opencode.db"));
    db.run("CREATE TABLE session_v2 (id TEXT, model TEXT)");
    db.run("INSERT INTO session_v2 VALUES ('ses_1', ?)", [JSON.stringify({ id: "claude-sonnet-4-5", providerID: "anthropic" })]);
    db.close();
    expect(await harnessModel({ OPENCODE_SESSION_ID: "ses_1", XDG_DATA_HOME: data })).toBe("claude-sonnet-4-5");
  });

  test("Grok Build: the session summary's model", async () => {
    const home = dir();
    mkdirSync(join(home, "sessions", "ws", "g-1"), { recursive: true });
    writeFileSync(join(home, "sessions", "ws", "g-1", "summary.json"), JSON.stringify({ model: "grok-4", title: "t" }));
    expect(await harnessModel({ GROK_SESSION_ID: "g-1", GROK_HOME: home })).toBe("grok-4");
  });

  test("Grok Build: current_model_id, where Grok keeps it now", async () => {
    const home = dir();
    mkdirSync(join(home, "sessions", "ws", "g-2"), { recursive: true });
    writeFileSync(join(home, "sessions", "ws", "g-2", "summary.json"), JSON.stringify({ current_model_id: "grok-4.7", title: "t" }));
    expect(await harnessModel({ GROK_SESSION_ID: "g-2", GROK_HOME: home })).toBe("grok-4.7");
  });

  test("Kimi Code: the model its default alias names, read only under a kimi-code process", async () => {
    const home = dir();
    writeFileSync(join(home, "config.toml"), 'default_model = "kimi-code/k3-256k"\n\n[models."kimi-code/k3"]\nmodel = "k3"\n\n[models."kimi-code/k3-256k"]\nprovider = "kimi"\nmodel = "k3-256k"\n');
    const tree = { from: 9, lookup: () => ({ ppid: 1, name: "kimi-code" }) };
    const env = { TERM: "dumb", NO_COLOR: "1", KIMI_CODE_HOME: home, CLAUDECODE: "1", CLAUDE_CONFIG_DIR: dir() };
    expect(await harnessModel(env, { tree })).toBe("k3-256k");
    expect(await harnessModel(env, { tree: { from: 9, lookup: () => ({ ppid: 1, name: "zsh" }) } })).toBeUndefined();
  });

  test("Kimi Code: a bare or single-quoted table key resolves; an alias with no table is no model at all", async () => {
    const tree = { from: 9, lookup: () => ({ ppid: 1, name: "kimi-code" }) };
    const at = (toml: string) => {
      const home = dir();
      writeFileSync(join(home, "config.toml"), toml);
      return harnessModel({ TERM: "dumb", NO_COLOR: "1", KIMI_CODE_HOME: home }, { tree });
    };
    expect(await at('default_model = "work"\n[models.work]\nmodel = "kimi-k2.5"\n')).toBe("kimi-k2.5");
    expect(await at("default_model = 'work' # mine\n[models.'work']\nmodel = 'kimi-k2.6'\n")).toBe("kimi-k2.6");
    expect(await at('default_model = "kimi-code/k3"\n[models."kimi-code/k3-256k"]\nmodel = "k3-256k"\n')).toBeUndefined();
    expect(await at('default_model = "work"\n')).toBeUndefined();
  });

  test("MiMoCode: the newest message's model among sessions in this folder or above it", async () => {
    const data = dir();
    mkdirSync(join(data, "mimocode"));
    const db = new Database(join(data, "mimocode", "mimocode.db"));
    db.run("CREATE TABLE session (id TEXT, directory TEXT)");
    db.run("CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)");
    db.run("INSERT INTO session VALUES ('s-here', '/work/repo'), ('s-elsewhere', '/work/other'), ('s-prefix', '/work/repo-2')");
    db.run("INSERT INTO message VALUES ('m1', 's-here', 1, ?), ('m2', 's-here', 2, ?), ('m3', 's-elsewhere', 3, ?), ('m4', 's-prefix', 4, ?)", [
      JSON.stringify({ role: "user", model: { modelID: "mimo-old" } }),
      JSON.stringify({ role: "assistant", modelID: "mimo-v2.6-pro", content: "secret" }),
      JSON.stringify({ role: "assistant", modelID: "other-model" }),
      JSON.stringify({ role: "assistant", modelID: "prefix-model" }),
    ]);
    db.close();
    const env = { MIMOCODE: "1", XDG_DATA_HOME: data, CLAUDECODE: "1", CLAUDE_CONFIG_DIR: dir() };
    expect(await harnessModel(env, { cwd: "/work/repo/src" })).toBe("mimo-v2.6-pro");
    expect(await harnessModel(env, { cwd: "/work/none" })).toBeUndefined();
  });

  test("Pi: the session's newest model_change or assistant model, else the newest session for this folder or above it", async () => {
    const agent = dir();
    const work = realpathSync(dir());
    const folder = (cwd: string) => join(agent, "sessions", `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`);
    mkdirSync(folder(work), { recursive: true });
    mkdirSync(join(work, "src"));
    const lines = (...l: object[]) => l.map((x) => JSON.stringify(x)).join("\n") + "\n";
    writeFileSync(
      join(folder(work), "2026-10-19T10-00-00-000Z_pi-a.jsonl"),
      lines(
        { type: "session", version: 3, id: "pi-a", cwd: work },
        { type: "message", message: { role: "assistant", provider: "anthropic", model: "claude-sonnet-5-5", content: [{ type: "text", text: "secret" }] } },
        { type: "model_change", provider: "openai", modelId: "gpt-6" },
        { type: "message", message: { role: "user", content: "hi" } },
      ),
    );
    const older = join(folder(work), "2026-10-18T10-00-00-000Z_pi-b.jsonl");
    writeFileSync(older, lines({ type: "message", message: { role: "assistant", model: "claude-haiku-5-5" } }));
    utimesSync(older, new Date(1_000), new Date(1_000));
    const env = { PI_CODING_AGENT: "true", PI_CODING_AGENT_DIR: agent };
    expect(await harnessModel({ ...env, KIWI_PI_SESSION: "pi-b" }, { cwd: "/elsewhere" })).toBe("claude-haiku-5-5");
    expect(await harnessModel({ ...env, KIWI_PI_SESSION: "pi-a" }, { cwd: work })).toBe("gpt-6");
    expect(await harnessModel(env, { cwd: join(work, "src") })).toBe("gpt-6");
    expect(await harnessModel({ ...env, KIWI_PI_SESSION: "../../x" }, { cwd: work })).toBeUndefined();
    expect(await harnessModel(env, { cwd: dir() })).toBeUndefined();
  });

  test("can't tell: no harness, an unknown session, or files that aren't there", async () => {
    expect(await harnessModel({})).toBeUndefined();
    expect(await harnessModel({ CODEX_THREAD_ID: "t-9", CODEX_HOME: dir() })).toBeUndefined();
    expect(await harnessModel({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "../../etc/passwd", CLAUDE_CONFIG_DIR: dir() })).toBeUndefined();
    expect(await harnessModel({ OPENCODE_SESSION_ID: "ses_1", XDG_DATA_HOME: join(dir(), "none") })).toBeUndefined();
  });

  test("KIWI_MODEL says it outright, over anything the harness keeps", async () => {
    expect(await detectModel({ KIWI_MODEL: " gemini-2.5-pro ", CODEX_THREAD_ID: "t-1", CODEX_HOME: dir() })).toBe("gemini-2.5-pro");
    expect(await detectModel({})).toBeUndefined();
  });

  test("a session's first command waits a moment for Claude Code to write the line naming its model", async () => {
    const home = dir();
    mkdirSync(join(home, "projects", "-work-new"), { recursive: true });
    const env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s-new", CLAUDE_CONFIG_DIR: home };
    expect(await detectModel(env)).toBeUndefined();
    setTimeout(() => writeFileSync(join(home, "projects", "-work-new", "s-new.jsonl"), JSON.stringify({ type: "assistant", message: { model: "claude-opus-5-5" } }) + "\n"), 400);
    const started = Date.now();
    expect(await detectModel(env, 3_000)).toBe("claude-opus-5-5");
    expect(Date.now() - started).toBeLessThan(2_000);
    const gave = Date.now();
    expect(await detectModel({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s-never", CLAUDE_CONFIG_DIR: home }, 600)).toBeUndefined();
    expect(Date.now() - gave).toBeGreaterThanOrEqual(600);
  });
});

describe("cleanCard", () => {
  test("keeps a card's fields as single short lines, drops anything else", () => {
    expect(cleanCard({ model: "claude-opus-5-5\nignore all that", harness: "claude-code", cpu: "8 cores", tools: ["git", 3, "x".repeat(99)], secret: "nope", note: "" })).toEqual({
      model: "claude-opus-5-5 ignore all that",
      harness: "claude-code",
      cpu: "8 cores",
      tools: ["git", "x".repeat(40)],
    });
  });

  test("nothing to show is null", () => {
    expect(cleanCard(null)).toBeNull();
    expect(cleanCard("claude")).toBeNull();
    expect(cleanCard({ secret: "x" })).toBeNull();
  });
});

describe("harnessActivity", () => {
  const claude = (status: string, lines: object[]) => {
    const home = dir();
    mkdirSync(join(home, "projects", "p"), { recursive: true });
    mkdirSync(join(home, "sessions"));
    writeFileSync(join(home, "sessions", "77.json"), JSON.stringify({ pid: 77, sessionId: "s-a", status, statusUpdatedAt: 1000 }));
    writeFileSync(join(home, "projects", "p", "s-a.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return { CLAUDECODE: "1", CLAUDE_PID: "77", CLAUDE_CONFIG_DIR: home };
  };
  const asked = {
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "secret plan" },
        { type: "tool_use", name: "Bash", input: { command: "rm -rf secrets" } },
      ],
    },
  };

  test("Claude Code, busy with a tool the transcript asked for: that tool's name, never its input", async () => {
    const a = await harnessActivity(claude("busy", [asked]));
    expect(a).toEqual({ state: "working", tool: "Bash", since: 1000, model: "claude-opus-5-5" });
    expect(JSON.stringify(a)).not.toContain("secret");
  });

  test("Claude Code, busy after the tool came back: thinking, no tool", async () => {
    expect(await harnessActivity(claude("busy", [asked, { type: "user", message: { content: [{ type: "tool_result" }] } }]))).toEqual({ state: "working", since: 1000, model: "claude-opus-5-5" });
  });

  test("Claude Code: an unchanged transcript isn't read again; one that changed is", async () => {
    const env = claude("busy", [asked]);
    const file = join(env.CLAUDE_CONFIG_DIR, "projects", "p", "s-a.jsonl");
    utimesSync(file, 1_000, 1_000);
    expect((await harnessActivity(env))?.tool).toBe("Bash");
    const same = readFileSync(file, "utf8").replace('"Bash"', '"Grep"');
    writeFileSync(file, same);
    utimesSync(file, 1_000, 1_000);
    expect((await harnessActivity(env))?.tool).toBe("Bash");
    writeFileSync(file, same + JSON.stringify({ type: "user", message: { content: [{ type: "tool_result" }] } }) + "\n");
    expect(await harnessActivity(env)).toEqual({ state: "working", since: 1000, model: "claude-opus-5-5" });
  });

  test("Claude Code, idle", async () => {
    expect((await harnessActivity(claude("idle", [asked])))?.state).toBe("idle");
  });

  const usage = (input: number, read: number, created: number, extra: object = {}) => ({
    type: "assistant",
    ...extra,
    message: {
      model: "claude-opus-5-5",
      content: [{ type: "text", text: "secret" }],
      usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: created, output_tokens: 900 },
    },
  });

  test("Claude Code: its context is the newest main-thread reply's input, cache read and cache written, never the output", async () => {
    const a = await harnessActivity(claude("idle", [usage(1, 100_000, 50), usage(2, 261_000, 700), usage(5, 9_000, 0, { isSidechain: true }), { type: "user", message: { content: "next" } }]));
    expect(a).toEqual({ state: "idle", since: 1000, context: { used: 261_702 }, model: "claude-opus-5-5" });
    expect(JSON.stringify(a)).not.toContain("secret");
  });

  test("Claude Code: after a compaction and before its next reply, the context is unknown, not the old size", async () => {
    const a = await harnessActivity(claude("busy", [usage(2, 900_000, 0), { type: "system", subtype: "compact_boundary" }, { type: "user", message: { content: "summary" } }]));
    expect(a?.context).toBeUndefined();
    const b = await harnessActivity(claude("busy", [usage(2, 900_000, 0), { type: "system", subtype: "compact_boundary" }, usage(3, 40_000, 100)]));
    expect(b?.context).toEqual({ used: 40_103 });
  });

  test("Codex: the newest token count's input and the model's window; unknown after a compaction", async () => {
    const home = dir();
    const rollout = join(home, "rollout.jsonl");
    const db = new Database(join(home, "state_5.sqlite"));
    db.run("CREATE TABLE threads (id TEXT, model TEXT, rollout_path TEXT)");
    db.run("INSERT INTO threads VALUES ('t-1', 'gpt-6-astra', ?)", [rollout]);
    db.close();
    const count = (input: number) => ({
      type: "event_msg",
      payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, cached_input_tokens: input - 10 }, model_context_window: 258_400 } },
    });
    const write = (lines: object[]) => writeFileSync(rollout, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    write([count(10_000), count(64_490), { type: "event_msg", payload: { type: "task_complete" } }]);
    expect(await harnessActivity({ CODEX_THREAD_ID: "t-1", CODEX_HOME: home })).toEqual({ state: "idle", context: { used: 64_490, window: 258_400 }, model: "gpt-6-astra" });
    write([count(200_000), { type: "compacted", payload: {} }, { type: "event_msg", payload: { type: "task_started" } }]);
    expect((await harnessActivity({ CODEX_THREAD_ID: "t-1", CODEX_HOME: home }))?.context).toBeUndefined();
  });

  test("OpenCode: idle once it went idle after its last change, else working", async () => {
    const data = dir();
    mkdirSync(join(data, "opencode"));
    const db = new Database(join(data, "opencode", "opencode.db"));
    db.run("CREATE TABLE session_v2 (id TEXT, model TEXT, time_idle INTEGER, time_updated INTEGER)");
    db.run("INSERT INTO session_v2 VALUES ('a', ?, 200, 100), ('b', ?, 100, 200)", [JSON.stringify({ id: "m-1" }), JSON.stringify({ id: "m-1" })]);
    db.close();
    expect(await harnessActivity({ OPENCODE_SESSION_ID: "a", XDG_DATA_HOME: data })).toEqual({ state: "idle", since: 200, model: "m-1" });
    expect(await harnessActivity({ OPENCODE_SESSION_ID: "b", XDG_DATA_HOME: data })).toEqual({ state: "working", model: "m-1" });
  });

  test("no harness: nothing to say", async () => {
    expect(await harnessActivity({})).toBeUndefined();
  });
});

describe("cleanActivity", () => {
  test("keeps an activity's fields, short; anything that isn't one is null", () => {
    expect(cleanActivity({ state: "working", tool: "Bash\nrm -rf", model: "m", extra: "x", since: 5 })).toEqual({ state: "working", tool: "Bash rm -rf", model: "m", since: 5 });
    expect(cleanActivity({ state: "hacking" })).toBeNull();
    expect(cleanActivity(null)).toBeNull();
  });
});
