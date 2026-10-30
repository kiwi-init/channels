// Seats: which agent a command or hook acts for, with no -c/--as. Several agents can work from one
// checkout; a session finds its own seat, a restart takes its old one back, and a second live agent
// never acts as the first.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessTree } from "../src/ancestry.ts";
import { loadConfig, updateConfig, wipeChannel } from "../src/config.ts";
import { freeAgentName } from "@kiwi/core/membership.ts";
import { baseName, bindDirectory, bindingFor, canonicalHarness, here, hereAs, sameHarness, seatsAt, seatsFor, seatsHeldAnywhere } from "../src/seats.ts";

let home = "";
let dir = "";
const prevHome = process.env.KIWI_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kiwi-seats-"));
  dir = join(home, "proj");
  mkdirSync(dir);
  process.env.KIWI_HOME = home;
  // Seats only count for channels this machine knows.
  updateConfig((c) => {
    c.channels.ch = { roomId: "room", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "http://127.0.0.1:1", code: "mc2-x" } as never;
    c.channels.other = { roomId: "room2", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "http://127.0.0.1:1", code: "mc2-y" } as never;
  });
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/** A pid that isn't running: a session that's gone. */
const DEAD = 2 ** 22 + 12345;
const NO_TREE: ProcessTree = { lookup: () => null };

test("what each harness says about itself", () => {
  expect(here({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s1", CLAUDE_PID: "42" })).toEqual({ harness: "claude", session: "s1", pid: 42 });
  expect(here({ CODEX_THREAD_ID: "t1" })).toEqual({ harness: "codex", session: "t1" });
  expect(here({ GROK_SESSION_ID: "g1" })).toEqual({ harness: "grok", session: "g1" });
  expect(here({ CLAUDECODE: "1", GROK_SESSION_ID: "g1" })).toEqual({ harness: "grok", session: "g1" });
  expect(here({ GEMINI_CLI: "1" }, NO_TREE)).toEqual({ harness: "gemini" });
  expect(here({ CURSOR_AGENT: "1" })).toEqual({ harness: "cursor" });
  expect(here({ CURSOR_AGENT: "1", CURSOR_CONVERSATION_ID: "chat-1" })).toEqual({ harness: "cursor", session: "chat-1" });
  expect(here({}, {}, "grok-bot-vm-53703001")).toEqual({ harness: "grok-bot" });
  expect(here({ KIWI_HARNESS: "grok-bot" }, {}, "a-mac")).toEqual({ harness: "grok-bot" });
  expect(here({ CODEX_THREAD_ID: "t1" }, {}, "grok-bot-vm-1")).toEqual({ harness: "codex", session: "t1" });
  expect(here({ CURSOR_AGENT: "1", CURSOR_CONVERSATION_ID: "c1" }, {}, "grok-bot-vm-1")).toEqual({ harness: "grok-bot" });
  expect(here({ CURSOR_AGENT: "1", KIWI_HARNESS: "grok-bot" }, {}, "a-mac")).toEqual({ harness: "grok-bot" });
  expect(here({ CURSOR_AGENT: "1", CURSOR_CONVERSATION_ID: "c1" }, {}, "a-mac")).toEqual({ harness: "cursor", session: "c1" });
  expect(here({}, {}, "a-mac")).toEqual({});
  expect(canonicalHarness("grokbot")).toBe("grok-bot");
  expect(here({})).toEqual({});
  expect(baseName(here({ CLAUDECODE: "1" }))).toBe("claude");
  expect(baseName(here({ CLAUDECODE: "1", GROK_SESSION_ID: "g1" }))).toBe("grok");
  expect(baseName({})).toBe("agent");
  expect(canonicalHarness("claude")).toBe("claude-code");
  expect(canonicalHarness("claude-code")).toBe("claude-code");
  expect(canonicalHarness("grok")).toBe("grok");
  expect(sameHarness("claude", "claude-code")).toBe(true);
  expect(sameHarness("claude-code", "claude")).toBe(true);
  expect(sameHarness("claude", "grok")).toBe(false);
  expect(canonicalHarness("kimi")).toBe("kimi-code");
  expect(canonicalHarness("mimo")).toBe("mimocode");
});

test("a hook that names its harness is that harness's, whatever the session that started it left in the environment", () => {
  const nested = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s1", CLAUDE_PID: String(process.pid), CODEX_THREAD_ID: "t1", GROK_SESSION_ID: "g1" };
  expect(hereAs("codex", nested)).toEqual({ harness: "codex", session: "t1" });
  expect(hereAs("grok", nested)).toEqual({ harness: "grok", session: "g1" });
  expect(hereAs("gemini", nested, NO_TREE)).toEqual({ harness: "gemini" });
  expect(hereAs(undefined, nested)).toEqual(here(nested));
  bindDirectory(dir, { alias: "ch", as: "claude-seat", harness: "claude", session: "s1", pid: process.pid });
  expect(seatsFor(dir, { who: hereAs("codex", nested) })).toEqual([]);
  expect(seatsHeldAnywhere(hereAs("codex", nested))).toEqual([]);
  expect(seatsAt(loadConfig(), dir).map((b) => b.session)).toEqual(["s1"]);
});

test("a named harness with no session never takes a folder's only seat from another harness or a live session", () => {
  const parent = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "parent", CLAUDE_PID: String(process.pid) };
  bindDirectory(dir, { alias: "ch", as: "parent-seat", harness: "claude", session: "parent", pid: process.pid });
  expect(hereAs("codex", parent)).toEqual({ harness: "codex" });
  expect(seatsFor(dir, { who: hereAs("codex", parent), claim: false })).toEqual([]);
  expect(seatsFor(dir, { who: hereAs("grok", parent), claim: false })).toEqual([]);
  expect(seatsFor(dir, { who: hereAs("gemini", parent, NO_TREE), claim: false })).toEqual([]);
  expect(seatsFor(dir, { who: {}, claim: false }).map((b) => b.as)).toEqual(["parent-seat"]);

  const other = join(home, "other");
  mkdirSync(other);
  bindDirectory(other, { alias: "ch", as: "live-codex", harness: "codex", session: "t1" });
  expect(seatsFor(other, { who: hereAs("codex", {}), claim: false })).toEqual([]);

  const gem = join(home, "gem");
  mkdirSync(gem);
  bindDirectory(gem, { alias: "ch", as: "gemini", harness: "gemini" });
  expect(seatsFor(gem, { who: hereAs("gemini", parent, NO_TREE), claim: false }).map((b) => b.as)).toEqual(["gemini"]);
});

test("Gemini: its own process holds the seat, so a second live Gemini in the checkout is someone else and a restarted one takes its seat back", () => {
  const tree = (...names: string[]): ProcessTree => ({
    from: 50,
    lookup: (pid) => {
      const name = names[50 - pid];
      return name ? { ppid: pid - 1, name } : null;
    },
  });
  const first = here({ GEMINI_CLI: "1" }, tree("bash", "node", "node", "zsh"));
  expect(first).toEqual({ harness: "gemini", session: "gemini-pid-49", pid: 49 });
  expect(hereAs("gemini", {}, tree("sh", "gemini"))).toEqual({ harness: "gemini", session: "gemini-pid-49", pid: 49 });
  expect(here({ GEMINI_CLI: "1" }, tree("bash", "claude", "node"))).toEqual({ harness: "gemini" });

  const live = { harness: "gemini" as const, session: `gemini-pid-${process.pid}`, pid: process.pid };
  bindDirectory(dir, { alias: "ch", as: "gem-one", ...live });
  const second = { harness: "gemini" as const, session: "gemini-pid-777", pid: 777 };
  expect(seatsFor(dir, { who: second, claim: false })).toEqual([]);
  expect(bindingFor(dir, { who: live })?.as).toBe("gem-one");

  bindDirectory(dir, { alias: "ch", as: "gem-gone", harness: "gemini", session: `gemini-pid-${DEAD}`, pid: DEAD });
  expect(seatsFor(dir, { who: second }).map((b) => b.as)).toEqual(["gem-gone"]);
  expect(seatsAt(loadConfig(), dir).find((b) => b.as === "gem-gone")).toMatchObject({ session: "gemini-pid-777", pid: 777 });
});

test("an agent Channels started, in a harness kiwi can't recognise, is told apart by its launch: it never takes the folder's seat, and finds its own", () => {
  const launched = { KIWI_LAUNCH: "fromTheApp_0123456789", KIWI_HARNESS: "kimi" };
  expect(here(launched, NO_TREE)).toEqual({ harness: "kimi", session: "launch-fromTheApp_0123456789" });
  expect(here({ KIWI_LAUNCH: "fromTheApp_0123456789", KIWI_HARNESS: "vim" }, NO_TREE)).toEqual({ session: "launch-fromTheApp_0123456789" });
  expect(here({ ...launched, CODEX_THREAD_ID: "t1" }, NO_TREE)).toEqual({ harness: "codex", session: "t1" });
  expect(here({ KIWI_LAUNCH: "no good; id" }, NO_TREE)).toEqual({});

  bindDirectory(dir, { alias: "ch", as: "first", harness: "claude", session: "s1" });
  const who = here(launched, NO_TREE);
  expect(seatsFor(dir, { who, claim: false })).toEqual([]);
  expect(seatsFor(dir, { who: {}, claim: false }).map((b) => b.as)).toEqual(["first"]);
  bindDirectory(dir, { alias: "ch", as: "second", ...who });
  expect(bindingFor(dir, { who })?.as).toBe("second");
  expect(bindingFor(dir, { who: { harness: "claude", session: "s1" } })?.as).toBe("first");
});

test("MiMoCode and Kimi Code: the harness's own process holds the seat, over the CLAUDECODE they pass through", () => {
  const chain = (...names: string[]) => {
    const procs = new Map(names.map((name, i) => [100 - i, { ppid: i === names.length - 1 ? 1 : 99 - i, name }]));
    return { from: 100, lookup: (pid: number) => procs.get(pid) ?? null };
  };
  expect(here({ MIMOCODE: "1", MIMOCODE_PID: "99", CLAUDECODE: "1" }, chain("zsh", "mimo", "claude"))).toEqual({ harness: "mimo", session: "mimo-pid-99", pid: 99 });
  expect(here({ MIMOCODE: "1" })).toEqual({ harness: "mimo" });
  expect(here({ MIMOCODE: "1", MIMOCODE_PID: "99", MIMOCODE_SESSION_ID: "ses_root" }, chain("zsh", "mimo"))).toEqual({ harness: "mimo", session: "ses_root", pid: 99 });
  expect(here({ MIMOCODE: "1", MIMOCODE_SESSION_ID: "ses_root" })).toEqual({ harness: "mimo", session: "ses_root" });
  expect(here({ TERM: "dumb", NO_COLOR: "1", CLAUDECODE: "1" }, chain("zsh", "kimi-code", "claude"))).toEqual({ harness: "kimi", session: "kimi-pid-99", pid: 99 });
  expect(here({ CLAUDECODE: "1" }, chain("zsh", "kimi-code"))).toEqual({ harness: "claude" });
  expect(here({ TERM: "dumb", NO_COLOR: "1" }, chain("zsh", "bash"))).toEqual({});
  expect(baseName(here({ MIMOCODE: "1", MIMOCODE_PID: "99" }, chain("zsh", "mimo")))).toBe("mimo");
});

test("ZCode: its own process holds the seat, over the Claude markers it passes through, unless a harness runs nearer", () => {
  const chain = (...names: string[]) => {
    const procs = new Map(names.map((name, i) => [100 - i, { ppid: i === names.length - 1 ? 1 : 99 - i, name }]));
    return { from: 100, lookup: (pid: number) => procs.get(pid) ?? null };
  };
  const zcode = { ZCODE_RUNTIME_ENV: "production" };
  expect(here(zcode, chain("zsh", "zcode-cli", "fnm"))).toEqual({ harness: "zcode", session: "zcode-pid-99", pid: 99 });
  expect(here({ ...zcode, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "c1" }, chain("zsh", "zcode-cli", "claude"))).toEqual({ harness: "zcode", session: "zcode-pid-99", pid: 99 });
  expect(here({ ...zcode, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "c1" }, chain("zsh", "claude", "zcode-cli"))).toEqual({ harness: "claude", session: "c1" });
  expect(here({}, chain("zsh", "zcode-cli"))).toEqual({});
  expect(baseName(here(zcode, chain("zsh", "zcode-cli")))).toBe("zcode");
});

test("Pi: its marker names the harness; its extension's process and session hold the seat, unless a harness runs nearer", () => {
  const chain = (...names: string[]) => {
    const procs = new Map(names.map((name, i) => [100 - i, { ppid: i === names.length - 1 ? 1 : 99 - i, name }]));
    return { from: 100, lookup: (pid: number) => procs.get(pid) ?? null };
  };
  expect(here({ PI_CODING_AGENT: "true" })).toEqual({ harness: "pi" });
  expect(here({ PI_CODING_AGENT: "true", CLAUDECODE: "1" })).toEqual({ harness: "claude" });
  expect(here({ PI_CODING_AGENT: "1" })).toEqual({});
  expect(here({ PI_CODING_AGENT: "true", KIWI_PI_PID: "99", KIWI_PI_SESSION: "pi-s1", CLAUDECODE: "1" }, chain("zsh", "node", "claude"))).toEqual({ harness: "pi", session: "pi-s1", pid: 99 });
  expect(here({ PI_CODING_AGENT: "true", KIWI_PI_PID: "97", KIWI_PI_SESSION: "pi-s1", CLAUDECODE: "1" }, chain("zsh", "claude", "bash", "node"))).toEqual({ harness: "claude" });
  expect(here({ PI_CODING_AGENT: "true", KIWI_PI_PID: "98", MIMOCODE: "1", MIMOCODE_PID: "96" }, chain("zsh", "node", "bash", "mimo"))).toEqual({ harness: "pi", pid: 98 });
  expect(baseName(here({ PI_CODING_AGENT: "true" }))).toBe("pi");
  expect(canonicalHarness("pi")).toBe("pi");
});

test("the nearest harness process decides when one harness runs inside another", () => {
  const chain = (...names: string[]) => {
    const procs = new Map(names.map((name, i) => [100 - i, { ppid: i === names.length - 1 ? 1 : 99 - i, name }]));
    return { from: 100, lookup: (pid: number) => procs.get(pid) ?? null };
  };
  expect(here({ TERM: "dumb", NO_COLOR: "1", CODEX_THREAD_ID: "codex-child" }, chain("zsh", "codex", "kimi-code"))).toEqual({ harness: "codex", session: "codex-child" });
  expect(here({ GROK_SESSION_ID: "parent-grok", MIMOCODE: "1", MIMOCODE_PID: "50" }, chain("zsh", "bun", "grok"))).toEqual({ harness: "grok", session: "parent-grok" });
  expect(here({ GROK_SESSION_ID: "parent-grok", MIMOCODE: "1", MIMOCODE_PID: "98" }, chain("zsh", "mimo-worker", "mimo", "grok"))).toEqual({ harness: "mimo", session: "mimo-pid-98", pid: 98 });
  expect(here({ GROK_SESSION_ID: "child-grok", MIMOCODE: "1", MIMOCODE_PID: "98" }, chain("zsh", "grok", "mimo"))).toEqual({ harness: "grok", session: "child-grok" });
  expect(here({ GROK_SESSION_ID: "g", MIMOCODE: "1" })).toEqual({ harness: "grok", session: "g" });
});

test("a second agent of a harness kiwi can't tell never replaces the first one's seat", () => {
  bindDirectory(dir, { alias: "ch", as: "agent", plain: true });
  bindDirectory(dir, { alias: "ch", as: "glm", plain: true });
  expect(seatsAt(loadConfig(), dir).map((b) => b.as)).toEqual(["agent", "glm"]);
  bindDirectory(dir, { alias: "ch", as: "gemini", harness: "gemini" });
  bindDirectory(dir, { alias: "ch", as: "gemini-2", harness: "gemini" });
  expect(seatsAt(loadConfig(), dir).map((b) => b.as)).toEqual(["agent", "glm", "gemini-2"]);
});

test("a session finds its own seat; a second live session in the same checkout finds none", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "s1", pid: process.pid });
  expect(bindingFor(join(dir, "src"), { who: { harness: "claude", session: "s1", pid: process.pid } })?.as).toBe("claude");
  // Another Claude Code session, while the first one's process lives: not its seat.
  expect(bindingFor(dir, { who: { harness: "claude", session: "s2", pid: process.pid + 1 } })).toBeNull();
});

test("a restart takes its old seat back once the session that held it is gone", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "old", pid: DEAD });
  const b = bindingFor(dir, { who: { harness: "claude", session: "new", pid: process.pid } });
  expect(b?.as).toBe("claude");
  // It's now this session's: the seat remembers it.
  expect(seatsAt(loadConfig(), dir)[0]).toMatchObject({ session: "new", pid: process.pid });
  // Another harness never takes a Claude seat.
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "x", pid: DEAD });
  expect(bindingFor(dir, { who: { harness: "codex", session: "t1" } })).toBeNull();
});

test("a restart on another model never takes the seat, one on the same or an unknown model does", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "old", pid: DEAD, model: "claude-opus-5-5" });
  expect(bindingFor(dir, { who: { harness: "claude", session: "sonnet", pid: process.pid, model: "claude-sonnet-5-5" } })).toBeNull();
  expect(seatsAt(loadConfig(), dir)[0]).toMatchObject({ session: "old", model: "claude-opus-5-5" });
  expect(bindingFor(dir, { who: { harness: "claude", session: "opus", pid: process.pid, model: "Claude-Opus-5-5[1m]" } })?.as).toBe("claude");
  expect(seatsAt(loadConfig(), dir)[0]).toMatchObject({ session: "opus", model: "Claude-Opus-5-5[1m]" });
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "gone", pid: DEAD, model: "claude-opus-5-5" });
  expect(bindingFor(dir, { who: { harness: "claude", session: "unknown", pid: process.pid } })?.as).toBe("claude");
  expect(seatsAt(loadConfig(), dir)[0]?.model).toBeUndefined();
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "gone-2", pid: DEAD });
  expect(bindingFor(dir, { who: { harness: "claude", session: "any", pid: process.pid, model: "claude-sonnet-5-5" } })?.as).toBe("claude");
});

test("two agents in one checkout each act as themselves", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "s1", pid: process.pid });
  bindDirectory(dir, { alias: "ch", as: "claude-2", harness: "claude", session: "s2", pid: process.pid });
  expect(seatsAt(loadConfig(), dir)).toHaveLength(2);
  expect(bindingFor(dir, { who: { harness: "claude", session: "s1", pid: process.pid } })?.as).toBe("claude");
  expect(bindingFor(dir, { who: { harness: "claude", session: "s2", pid: process.pid } })?.as).toBe("claude-2");
});

test("a session that holds two seats here is both agents, and bindingFor names neither", () => {
  const who = { harness: "claude" as const, session: "s1", pid: process.pid };
  bindDirectory(dir, { alias: "ch", as: "planner", harness: "claude", session: "s1", pid: process.pid });
  bindDirectory(dir, { alias: "other", as: "reviewer", harness: "claude", session: "s1", pid: process.pid });
  expect(seatsFor(dir, { who }).map((b) => `${b.as}@${b.alias}`)).toEqual(["planner@ch", "reviewer@other"]);
  expect(bindingFor(dir, { who })).toBeNull();
  expect(bindingFor(dir, { who, alias: "other" })?.as).toBe("reviewer");
  expect(seatsFor(dir, { who: { harness: "claude", session: "s2", pid: process.pid + 1 } })).toEqual([]);
});

test("a session's seats are found in every folder it joined from, never another session's", () => {
  const who = { harness: "claude" as const, session: "s1", pid: process.pid };
  const sibling = join(home, "proj-task");
  mkdirSync(sibling);
  bindDirectory(dir, { alias: "ch", as: "planner", harness: "claude", session: "s1", pid: process.pid });
  bindDirectory(sibling, { alias: "other", as: "reviewer", harness: "claude", session: "s1", pid: process.pid });
  bindDirectory(sibling, { alias: "ch", as: "claude-2", harness: "claude", session: "s2", pid: process.pid });
  expect(seatsFor(dir, { who }).map((b) => b.as)).toEqual(["planner"]);
  expect(
    seatsHeldAnywhere(who)
      .map((b) => `${b.as}@${b.alias}`)
      .sort(),
  ).toEqual(["planner@ch", "reviewer@other"]);
  expect(seatsHeldAnywhere({ harness: "claude" })).toEqual([]);
  updateConfig((c) => {
    delete c.channels.other;
  });
  expect(
    seatsAt(loadConfig(), sibling)
      .map((b) => b.as)
      .sort(),
  ).toEqual(["claude-2", "reviewer"]);
  expect(seatsHeldAnywhere(who).map((b) => b.as)).toEqual(["planner"]);
});

test("a seat found in another folder is marked as still in use, so no other session takes it for stale", () => {
  const sibling = join(home, "proj-task");
  mkdirSync(sibling);
  const old = Date.now() - 13 * 3600_000;
  bindDirectory(sibling, { alias: "ch", as: "codex", harness: "codex", session: "x" });
  updateConfig((c) => {
    c.bindings![sibling] = seatsAt(c, sibling).map((b) => ({ ...b, at: old, seen: old }));
  });
  expect(seatsHeldAnywhere({ harness: "codex", session: "x" }, { claim: false }).map((b) => b.as)).toEqual(["codex"]);
  expect(seatsAt(loadConfig(), sibling)[0]?.seen).toBe(old);
  expect(seatsHeldAnywhere({ harness: "codex", session: "x" }).map((b) => b.as)).toEqual(["codex"]);
  expect(seatsAt(loadConfig(), sibling)[0]?.seen ?? 0).toBeGreaterThan(old);
  expect(bindingFor(sibling, { who: { harness: "codex", session: "y" } })).toBeNull();
  expect(seatsHeldAnywhere({ harness: "codex", session: "x" }).map((b) => b.as)).toEqual(["codex"]);
});

test("a session's seats with no process to check are all marked as still in use", () => {
  const old = Date.now() - 3600_000;
  bindDirectory(dir, { alias: "ch", as: "planner", harness: "codex", session: "t1" });
  bindDirectory(dir, { alias: "other", as: "reviewer", harness: "codex", session: "t1" });
  updateConfig((c) => {
    c.bindings![dir] = seatsAt(c, dir).map((b) => ({ ...b, at: old, seen: old }));
  });
  expect(seatsFor(dir, { who: { harness: "codex", session: "t1" } })).toHaveLength(2);
  expect(seatsAt(loadConfig(), dir).every((b) => (b.seen ?? 0) > old)).toBe(true);
});

test("a plain terminal in a folder with one agent acts as it, as before seats; with two it guesses neither", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "s1", pid: process.pid });
  expect(bindingFor(dir, { who: {} })?.as).toBe("claude");
  bindDirectory(dir, { alias: "ch", as: "claude-2", harness: "claude", session: "s2", pid: process.pid });
  expect(bindingFor(dir, { who: {} })).toBeNull();
});

test("one seat in a folder is stored as a plain object", () => {
  bindDirectory(dir, { alias: "ch", as: "pic" });
  expect(Array.isArray(loadConfig().bindings?.[dir])).toBe(false);
});

test("a channel that's gone takes its seats with it, and leaves the others", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "s1", pid: process.pid });
  bindDirectory(dir, { alias: "other", as: "claude", harness: "claude", session: "s2", pid: process.pid });
  wipeChannel("ch");
  expect(seatsAt(loadConfig(), dir).map((b) => b.alias)).toEqual(["other"]);
});

test("free names: the base, then -2, -3…; every name anyone held stays taken", () => {
  expect(freeAgentName("claude", [])).toBe("claude");
  expect(freeAgentName("claude", [{ name: "Claude" }])).toBe("claude-2");
  expect(freeAgentName("claude", [{ name: "claude" }, { name: "claude-2" }])).toBe("claude-3");
  expect(freeAgentName("kiwi", [])).toBe("kiwi-2");
});

test("taking a seat drops the previous holder's process when the new session names none", () => {
  bindDirectory(dir, { alias: "ch", as: "codex", harness: "codex", session: "t0", pid: DEAD });
  expect(bindingFor(dir, { who: { harness: "codex", session: "t1" } })?.as).toBe("codex");
  expect(seatsAt(loadConfig(), dir)[0]!.pid).toBeUndefined();
});

test("a seat with no process to check is held by its session until it's gone quiet for half a day", () => {
  bindDirectory(dir, { alias: "ch", as: "codex", harness: "codex", session: "t1" });
  expect(bindingFor(dir, { who: { harness: "codex", session: "t2" } })).toBeNull();
  updateConfig((c) => {
    c.bindings![dir] = { ...(c.bindings![dir] as object), at: Date.now() - 13 * 3600_000, seen: Date.now() - 13 * 3600_000 } as never;
  });
  expect(bindingFor(dir, { who: { harness: "codex", session: "t2" } })?.as).toBe("codex");
});

test("several free seats of one harness: none is guessed", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "a", pid: DEAD });
  bindDirectory(dir, { alias: "ch", as: "claude-2", harness: "claude", session: "b", pid: DEAD });
  expect(bindingFor(dir, { who: { harness: "claude", session: "c", pid: process.pid } })).toBeNull();
});

test("a suffixed name still fits in 32 characters", () => {
  const base = "a".repeat(32);
  const taken = [{ name: base }, ...Array.from({ length: 99 }, (_, i) => ({ name: `${"a".repeat(31 - String(i + 2).length)}-${i + 2}` }))];
  const name = freeAgentName(base, taken);
  expect(name.length).toBeLessThanOrEqual(32);
  expect(name.endsWith("-101")).toBe(true);
});

test("a session's hooks name its own seat, never the seat a plain terminal joined into the same checkout (T1571)", () => {
  bindDirectory(dir, { alias: "ch", as: "claude" });
  bindDirectory(dir, { alias: "ch", as: "muse", plain: true });
  expect(seatsAt(loadConfig(), dir).map((b) => b.as)).toEqual(["claude", "muse"]);
  const coord = { harness: "claude" as const, session: "coord", pid: process.pid };
  expect(bindingFor(dir, { who: coord })?.as).toBe("claude");
  expect(bindingFor(dir, { who: {} })?.as).toBe("muse");
});

test("a session listening as an agent whose seat is gone gets it back beside the others", () => {
  bindDirectory(dir, { alias: "ch", as: "muse", plain: true });
  const coord = { harness: "claude" as const, session: "coord", pid: process.pid };
  expect(bindingFor(dir, { who: coord })).toBeNull();
  const listeners = () => [{ alias: "ch", as: "claude", harness: "claude" as const, session: "coord", pid: process.pid, cwd: dir }];
  expect(bindingFor(join(dir, "src"), { who: coord, listeners })?.as).toBe("claude");
  expect(
    seatsAt(loadConfig(), dir)
      .map((b) => b.as)
      .sort(),
  ).toEqual(["claude", "muse"]);
  expect(bindingFor(dir, { who: coord })?.as).toBe("claude");
  // The plain terminal is still muse.
  expect(bindingFor(dir, { who: {} })?.as).toBe("muse");
});

test("a seat with no session that someone else is listening as is never taken", () => {
  bindDirectory(dir, { alias: "ch", as: "pic" });
  const other = () => [{ alias: "ch", as: "pic", cwd: dir }];
  expect(bindingFor(dir, { who: { harness: "claude", session: "s1", pid: process.pid }, listeners: other })).toBeNull();
  // Nobody listening as it: a restarted agent takes its old seat back, as before.
  expect(bindingFor(dir, { who: { harness: "claude", session: "s1", pid: process.pid } })?.as).toBe("pic");
});

test("joining from a plain terminal doesn't push out an agent that's listening here", () => {
  bindDirectory(dir, { alias: "ch", as: "claude" });
  bindDirectory(dir, { alias: "ch", as: "muse", plain: true }, (_a, as) => as === "claude");
  expect(
    seatsAt(loadConfig(), dir)
      .map((b) => b.as)
      .sort(),
  ).toEqual(["claude", "muse"]);
});

test("live listeners say who started them; an older record only who it listens as", async () => {
  const { liveListeners, isListening } = await import("../src/hooks.ts");
  const dirL = join(home, "listeners");
  mkdirSync(dirL, { recursive: true });
  writeFileSync(join(dirL, `ch.a.b.${process.pid}`), JSON.stringify({ at: 1, alias: "ch", as: "a.b", cwd: dir, harness: "claude", session: "s1", pid: 42 }));
  writeFileSync(join(dirL, `ch.old.${process.pid}`), "1791507020412");
  writeFileSync(join(dirL, `ch.dead.${DEAD}`), "{}");
  expect(liveListeners().sort((x, y) => x.as.localeCompare(y.as))).toEqual([
    { alias: "ch", as: "a.b", cwd: dir, harness: "claude", session: "s1", pid: 42 },
    { alias: "ch", as: "old" },
  ]);
  expect(isListening("ch", "a.b")).toBe(true);
  expect(isListening("ch", "a")).toBe(false);
  // The dead one's record is gone.
  expect(isListening("ch", "dead")).toBe(false);
});

describe("listening as someone never makes you them (review of T1571)", () => {
  const A = { harness: "claude" as const, session: "A", pid: process.pid };
  const B = { harness: "claude" as const, session: "B", pid: process.pid + 1 };
  test("a session listening as a live session's agent doesn't take its seat", () => {
    // B's harness process has to be alive for B to hold its seat: use this test's own parent.
    const bLive = { ...B, pid: process.ppid };
    bindDirectory(dir, { alias: "ch", as: "b", harness: "claude", session: "B", pid: process.ppid });
    const listeners = () => [{ alias: "ch", as: "b", harness: "claude" as const, session: "A", pid: process.pid, cwd: dir }];
    expect(bindingFor(dir, { who: A, listeners })).toBeNull();
    expect(bindingFor(dir, { who: bLive, listeners })?.as).toBe("b");
    expect(seatsAt(loadConfig(), dir)).toEqual([expect.objectContaining({ as: "b", session: "B" })]);
  });
  test("a session with a seat of its own stays itself, from a subfolder or in another channel", () => {
    bindDirectory(dir, { alias: "ch", as: "a", harness: "claude", session: "A", pid: process.pid });
    const sub = join(dir, "sub");
    mkdirSync(sub);
    const listeners = () => [{ alias: "ch", as: "b", session: "A", pid: process.pid, cwd: sub }];
    expect(bindingFor(sub, { who: A, listeners })?.as).toBe("a");
    // Its seat is in "ch"; listening as someone in "other" doesn't make it them there either.
    const elsewhere = () => [{ alias: "other", as: "b", session: "A", pid: process.pid, cwd: dir }];
    expect(bindingFor(dir, { who: A, alias: "other", listeners: elsewhere })).toBeNull();
  });
  test("a session listening as an agent someone else also listens as doesn't become it", () => {
    bindDirectory(dir, { alias: "ch", as: "muse", plain: true });
    const listeners = () => [
      { alias: "ch", as: "muse", session: "A", pid: process.pid, cwd: dir },
      { alias: "ch", as: "muse", cwd: dir },
    ];
    expect(bindingFor(dir, { who: A, listeners })).toBeNull();
  });
  test("a plain-terminal agent keeps its seat while it listens, beside a live session", () => {
    bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "B", pid: process.ppid });
    bindDirectory(dir, { alias: "ch", as: "muse", plain: true });
    const listeners = () => [{ alias: "ch", as: "muse", cwd: dir }];
    expect(bindingFor(dir, { who: {}, listeners })?.as).toBe("muse");
    expect(bindingFor(dir, { who: { harness: "gemini" }, listeners })?.as).toBe("muse");
  });
});

test("listening as a plain-terminal or Gemini agent that isn't listening right now doesn't make a session it", () => {
  const A = { harness: "claude" as const, session: "A", pid: process.pid };
  bindDirectory(dir, { alias: "ch", as: "muse", plain: true });
  bindDirectory(dir, { alias: "ch", as: "gem", harness: "gemini" });
  for (const as of ["muse", "gem"]) {
    const listeners = () => [{ alias: "ch", as, harness: "claude" as const, session: "A", pid: process.pid, cwd: dir }];
    expect(bindingFor(dir, { who: A, listeners })?.as).not.toBe(as);
  }
  // Neither seat was rewritten to the session.
  expect(
    seatsAt(loadConfig(), dir)
      .map((b) => [b.as, b.session ?? null])
      .sort(),
  ).toEqual([
    ["gem", null],
    ["muse", null],
  ]);
  expect(seatsAt(loadConfig(), dir).find((b) => b.as === "muse")?.plain).toBe(true);
});
