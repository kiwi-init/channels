// Seats: which agent a command or hook acts for, with no -c/--as. Several agents can work from one
// checkout; a session finds its own seat, a restart takes its old one back, and a second live agent
// never acts as the first.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig, wipeChannel } from "../src/config.ts";
import { freeAgentName } from "../src/membership.ts";
import { baseName, bindDirectory, bindingFor, here, seatsAt } from "../src/seats.ts";

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

test("what each harness says about itself", () => {
  expect(here({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s1", CLAUDE_PID: "42" })).toEqual({ harness: "claude", session: "s1", pid: 42 });
  expect(here({ CODEX_THREAD_ID: "t1" })).toEqual({ harness: "codex", session: "t1" });
  expect(here({ GROK_SESSION_ID: "g1" })).toEqual({ harness: "grok", session: "g1" });
  expect(here({ CLAUDECODE: "1", GROK_SESSION_ID: "g1" })).toEqual({ harness: "grok", session: "g1" });
  expect(here({ GEMINI_CLI: "1" })).toEqual({ harness: "gemini" });
  expect(here({})).toEqual({});
  expect(baseName(here({ CLAUDECODE: "1" }))).toBe("claude");
  expect(baseName(here({ CLAUDECODE: "1", GROK_SESSION_ID: "g1" }))).toBe("grok");
  expect(baseName({})).toBe("agent");
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

test("two agents in one checkout each act as themselves", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "s1", pid: process.pid });
  bindDirectory(dir, { alias: "ch", as: "claude-2", harness: "claude", session: "s2", pid: process.pid });
  expect(seatsAt(loadConfig(), dir)).toHaveLength(2);
  expect(bindingFor(dir, { who: { harness: "claude", session: "s1", pid: process.pid } })?.as).toBe("claude");
  expect(bindingFor(dir, { who: { harness: "claude", session: "s2", pid: process.pid } })?.as).toBe("claude-2");
});

test("a plain terminal in a folder with one agent acts as it, as before seats; with two it guesses neither", () => {
  bindDirectory(dir, { alias: "ch", as: "claude", harness: "claude", session: "s1", pid: process.pid });
  expect(bindingFor(dir, { who: {} })?.as).toBe("claude");
  bindDirectory(dir, { alias: "ch", as: "claude-2", harness: "claude", session: "s2", pid: process.pid });
  expect(bindingFor(dir, { who: {} })).toBeNull();
});

test("without a session, the last join in a folder wins, as before seats", () => {
  bindDirectory(dir, { alias: "ch", as: "pic" });
  bindDirectory(dir, { alias: "other", as: "pic" });
  expect(seatsAt(loadConfig(), dir)).toEqual([expect.objectContaining({ alias: "other", as: "pic" })]);
  // One seat is stored as a plain object, which older clients read.
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
  // The coordinator's seat from before seats (no harness, no session), then another agent joins from a
  // plain terminal and the last-join-wins rule replaced it: only that other agent's seat is left.
  bindDirectory(dir, { alias: "ch", as: "claude" });
  bindDirectory(dir, { alias: "ch", as: "muse", plain: true });
  expect(seatsAt(loadConfig(), dir).map((b) => b.as)).toEqual(["muse"]);
  const coord = { harness: "claude" as const, session: "coord", pid: process.pid };
  // Never someone else's seat: a seat joined from a plain terminal isn't taken over by a session.
  expect(bindingFor(dir, { who: coord })).toBeNull();
  // The session listens as claude from here: that's who it is, and it gets its seat back beside muse's.
  const listeners = () => [{ alias: "ch", as: "claude", harness: "claude" as const, session: "coord", pid: process.pid, cwd: dir }];
  expect(bindingFor(join(dir, "src"), { who: coord, listeners })?.as).toBe("claude");
  expect(seatsAt(loadConfig(), dir).map((b) => b.as).sort()).toEqual(["claude", "muse"]);
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
  expect(seatsAt(loadConfig(), dir).map((b) => b.as).sort()).toEqual(["claude", "muse"]);
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
  expect(seatsAt(loadConfig(), dir).map((b) => [b.as, b.session ?? null]).sort()).toEqual([
    ["gem", null],
    ["muse", null],
  ]);
  expect(seatsAt(loadConfig(), dir).find((b) => b.as === "muse")?.plain).toBe(true);
});
