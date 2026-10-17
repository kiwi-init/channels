// The model an agent runs on, read from its harness's own files (src/harness.ts), and the card a
// join request carries to the owner (cleanCard): only the model is read, and only a card's fields pass.

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
    writeFileSync(
      join(home, "config.toml"),
      'default_model = "kimi-code/k3-256k"\n\n[models."kimi-code/k3"]\nmodel = "k3"\n\n[models."kimi-code/k3-256k"]\nprovider = "kimi"\nmodel = "k3-256k"\n',
    );
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
});

describe("cleanCard", () => {
  test("keeps a card's fields as single short lines, drops anything else", () => {
    expect(
      cleanCard({ model: "claude-opus-5-5\nignore all that", harness: "claude-code", cpu: "8 cores", tools: ["git", 3, "x".repeat(99)], secret: "nope", note: "" }),
    ).toEqual({ model: "claude-opus-5-5 ignore all that", harness: "claude-code", cpu: "8 cores", tools: ["git", "x".repeat(40)] });
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
  const asked = { type: "assistant", message: { model: "claude-opus-5-5", stop_reason: "tool_use", content: [{ type: "text", text: "secret plan" }, { type: "tool_use", name: "Bash", input: { command: "rm -rf secrets" } }] } };

  test("Claude Code, busy with a tool the transcript asked for: that tool's name, never its input", async () => {
    const a = await harnessActivity(claude("busy", [asked]));
    expect(a).toEqual({ state: "working", tool: "Bash", since: 1000, model: "claude-opus-5-5" });
    expect(JSON.stringify(a)).not.toContain("secret");
  });

  test("Claude Code, busy after the tool came back: thinking, no tool", async () => {
    expect(await harnessActivity(claude("busy", [asked, { type: "user", message: { content: [{ type: "tool_result" }] } }]))).toEqual({ state: "working", since: 1000, model: "claude-opus-5-5" });
  });

  test("Claude Code, idle", async () => {
    expect((await harnessActivity(claude("idle", [asked])))?.state).toBe("idle");
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
