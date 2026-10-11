// kiwi tui: keys out of raw input, the prompt's editing, wrapping, what a person sees in
// coordinator-only mode and where their words go, and one run against a real relay.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ed from "../src/tui/editor.ts";
import { KeyReader, plain, width, wrap, type Key } from "../src/tui/term.ts";
import { bodyLines, clean, messageLines } from "../src/tui/render.ts";
import { awaitedFrom, coordinatorFor, mentioned, route, shows } from "../src/tui/view.ts";
import { generateIdentity, sign, verify, type Identity } from "../src/identity.ts";
import type { Event, Kind, Message } from "../src/protocol.ts";
import { fold, type Roster } from "../src/state.ts";

setDefaultTimeout(60_000);

const keys = (...chunks: string[]): Key[] => {
  const r = new KeyReader();
  const out = chunks.flatMap((c) => r.feed(c));
  return [...out, ...r.flush()];
};

describe("keys", () => {
  test("arrows, words, ctrl, and a sequence split across reads", () => {
    expect(keys("\x1b[A", "\x1b[1;5C", "\x1bb", "\x01", "\r", "\x7f")).toEqual([
      { name: "up" },
      { name: "wordright" },
      { name: "wordleft" },
      { name: "ctrl", key: "a" },
      { name: "return" },
      { name: "backspace" },
    ]);
    const r = new KeyReader();
    expect(r.feed("\x1b")).toEqual([]);
    expect(r.feed("[")).toEqual([]);
    expect(r.feed("D")).toEqual([{ name: "left" }]);
  });

  test("a lone ESC is Escape once input goes quiet; shift+tab and CSI u shift+enter", () => {
    const r = new KeyReader();
    expect(r.feed("\x1b")).toEqual([]);
    expect(r.pending).toBe(true);
    expect(r.flush()).toEqual([{ name: "escape" }]);
    expect(keys("\x1b[Z")).toEqual([{ name: "backtab" }]);
    expect(keys("\x1b[13;2u")).toEqual([{ name: "newline" }]);
    expect(keys("\x1b\r")).toEqual([{ name: "newline" }]);
  });

  test("a bracketed paste is one key, even split across reads, line breaks kept", () => {
    expect(keys("\x1b[200~line one\r\nline", " two\x1b[201~", "x")).toEqual([
      { name: "paste", text: "line one\nline two" },
      { name: "text", text: "x" },
    ]);
  });

  test("typed text is one run; a burst with a line break inside is a paste, not a send", () => {
    expect(keys("héllo 👋🏽")).toEqual([{ name: "text", text: "héllo 👋🏽" }]);
    expect(keys("first\nsecond\n")).toEqual([{ name: "paste", text: "first\nsecond" }]);
    expect(keys("just this\r")).toEqual([{ name: "text", text: "just this" }, { name: "return" }]);
  });
});

describe("the prompt", () => {
  test("backspace and arrows step over whole graphemes", () => {
    let d = ed.insert(ed.empty(), "a👍🏽b");
    d = ed.left(d);
    d = ed.backspace(d);
    expect(d).toEqual({ text: "ab", cursor: 1 });
    d = ed.insert(d, "🇧🇷");
    expect(ed.right(ed.left(d)).cursor).toBe(d.cursor);
  });

  test("word and line editing", () => {
    const d = { text: "send it to win", cursor: 14 };
    expect(ed.deleteWordBack(d)).toEqual({ text: "send it to ", cursor: 11 });
    expect(ed.wordLeft(d).cursor).toBe(11);
    expect(ed.killToStart({ text: "one\ntwo", cursor: 7 })).toEqual({ text: "one\n", cursor: 4 });
    expect(ed.killToEnd({ text: "one\ntwo", cursor: 1 })).toEqual({ text: "o\ntwo", cursor: 1 });
    expect(ed.home({ text: "one\ntwo", cursor: 6 }).cursor).toBe(4);
    expect(ed.end({ text: "one\ntwo", cursor: 1 }).cursor).toBe(3);
  });

  test("layout wraps at the edge and finds the cursor; up/down keep the column", () => {
    const d = { text: "abcdefghij\nxy", cursor: 13 };
    const l = ed.layout(d, 5);
    expect(l.lines).toEqual(["abcd", "efgh", "ij", "xy"]);
    expect([l.row, l.col]).toEqual([3, 2]);
    expect(ed.vertical(d, 5, -1)).toEqual({ ...d, cursor: 10 });
    expect(ed.vertical({ ...d, cursor: 1 }, 5, 1)?.cursor).toBe(5);
    expect(ed.vertical({ ...d, cursor: 1 }, 5, -1)).toBeNull();
    // Wide characters take two columns.
    expect(ed.layout({ text: "漢字漢字", cursor: 0 }, 5).lines).toEqual(["漢字", "漢字"]);
  });

  test("history walks back and returns to the draft", () => {
    const h = new ed.History(["one", "two"]);
    expect(h.prev("draft")).toBe("two");
    expect(h.prev("two")).toBe("one");
    expect(h.prev("one")).toBeNull();
    expect(h.next()).toBe("two");
    expect(h.next()).toBe("draft");
    h.push("three");
    expect(h.prev("")).toBe("three");
  });
});

describe("text", () => {
  test("wrap breaks at spaces, splits long words, and never overflows", () => {
    expect(wrap("the quick brown fox", 9)).toEqual(["the quick", "brown fox"]);
    expect(wrap("abcdefghijkl", 5)).toEqual(["abcde", "fghij", "kl"]);
    for (const l of wrap("日本語のテキストと emoji 👋🏽 mixed together in one line", 7)) expect(width(l)).toBeLessThanOrEqual(7);
  });

  test("a message can't move the cursor, clear the screen or recolour the terminal", () => {
    const evil = "hi\x1b[2J\x1b[31mred\x1b]0;title\x07‮evil\rover";
    expect(clean(evil)).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f‮]/);
    for (const l of bodyLines(evil, 40)) expect(plain(l)).not.toContain("\x1b");
  });
});

// ---------- coordinator-only, from the person's side ----------

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { to?: string[]; ev?: Event; re?: number[] } = {}): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq });
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "lead", "dev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("what the person sees, and where it goes", () => {
  test("with the coordinator: their words and yours; agents' chat with each other only in Everything", async () => {
    const ms = [
      await msg("jon", "event", "", { ev: { op: "role.set", member: "lead", role: "coordinator" } }),
      await msg("jon", "event", "", { ev: { op: "mode.set", coordinatorOnly: true, strict: true } }),
      await msg("lead", "msg", "on it", { to: ["jon"] }),
      await msg("dev", "msg", "lead, done", { to: ["lead"] }),
      await msg("lead", "msg", "dev, next", { to: ["dev"] }),
      await msg("jon", "msg", "thanks", { to: ["lead"] }),
    ];
    const s = fold(ms, roster);
    expect(coordinatorFor(s, "jon")).toBe("lead");
    expect(coordinatorFor(s, "lead")).toBeNull();
    const seen = (view: "coordinator" | "everything") => ms.filter((m) => shows(m, view, s, "jon", null)).map((m) => m.body || m.ev?.op);
    expect(seen("coordinator")).toEqual(["role.set", "mode.set", "on it", "thanks"]);
    expect(seen("everything")).toEqual(["role.set", "mode.set", "on it", "lead, done", "dev, next", "thanks"]);
  });

  test("routing: to the coordinator; in Everything as written, copied to them; otherwise @mentions", async () => {
    const on = [await msg("jon", "event", "", { ev: { op: "role.set", member: "lead", role: "coordinator" } }), await msg("jon", "event", "", { ev: { op: "mode.set", coordinatorOnly: true, strict: true } })];
    const s = fold(on, roster);
    expect(route("@dev please look", "coordinator", s, "jon")).toEqual(["lead"]);
    expect(route("@dev please look", "everything", s, "jon")).toEqual(["dev", "lead"]);
    expect(route("hello all", "everything", s, "jon")).toBeUndefined();
    expect(awaitedFrom(["dev", "lead"], s, "jon")).toEqual({ names: ["dev", "lead"], shown: ["dev"] });
    expect(awaitedFrom(undefined, s, "jon")).toEqual({ names: ["lead"], shown: ["lead"] });
    const normal = fold([], roster);
    expect(route("@dev @lead, both of you", "coordinator", normal, "jon")).toEqual(["dev", "lead"]);
    expect(mentioned("hey @dev", normal, "jon")).toEqual([]);
    expect(awaitedFrom(undefined, normal, "jon")).toEqual({ names: null, shown: [] });
  });

  test("a question for you says how to answer it", async () => {
    const q = await msg("lead", "ask", "merge it?", { to: ["jon"] });
    const s = fold([q], roster);
    const lines = messageLines(q, { state: s, me: "jon", coordinator: null }, 80).map(plain);
    expect(lines[0]).toContain("lead asks");
    expect(lines.at(-1)).toContain(`/reply ${q.seq} to answer`);
  });
});

// ---------- the app against a relay ----------

describe("kiwi tui, end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-tui-"));
  const kiwiHome = join(dir, "home");
  let relay: { url: URL; stop: (force?: boolean) => void };
  const env = () => ({ ...process.env, KIWI_HOME: kiwiHome, KIWI_RELAY: relay.url.origin });
  const cli = async (...args: string[]) => {
    const p = Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), ...args], { cwd: dir, env: env(), stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
    return out;
  };

  beforeAll(async () => {
    const { startRelay } = await import("../src/relay/bun.ts");
    relay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(dir, "relay") });
  });
  afterAll(() => {
    relay?.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("the person writes to the coordinator, sees the answer, and turns the mode off", async () => {
    await cli("create", "tuitest", "--as", "lead");
    await cli("-c", "tuitest", "role", "lead", "coordinator", "--yes");
    await cli("-c", "tuitest", "mode", "coordinator-only", "on");

    const prior = process.env.KIWI_HOME;
    process.env.KIWI_HOME = kiwiHome;
    try {
      const { loadConfig } = await import("../src/config.ts");
      const { AgentSession } = await import("../src/agent.ts");
      const { runTui } = await import("../src/tui/app.ts");
      const cfg = loadConfig().channels.tuitest!;
      const s = await AgentSession.openPerson("tuitest", cfg, cfg.owner!);

      let screen = "";
      let feed: (chunk: string) => void = () => {};
      const term = { write: (x: string) => void (screen += x), cols: () => 90, rows: () => 30, onData: (cb: (c: string) => void) => void (feed = cb), onResize: () => {}, start: () => {}, stop: () => {} };
      const shown = () => plain(screen);
      const until = async (pred: () => boolean, label: string) => {
        const end = Date.now() + 15_000;
        while (!pred()) {
          if (Date.now() > end) throw new Error(`timed out waiting for ${label}; screen:\n${shown().slice(-2000)}`);
          await Bun.sleep(25);
        }
      };

      const running = runTui(s, { terminal: term, label: "human (owner)" });
      await until(() => shown().includes("Write to lead"), "the prompt");
      expect(shown()).toContain("coordinator-only: you talk with lead");

      feed("is the build green?");
      feed("\r");
      await until(() => shown().includes("Waiting for lead"), "the spinner");
      // The coordinator got it, addressed to them.
      const read = await cli("-c", "tuitest", "--as", "lead", "read");
      expect(read).toMatch(/human \(human, owner\) → lead: is the build green\?/);

      await cli("-c", "tuitest", "--as", "lead", "send", "--to", "human", "yes, all green");
      await until(() => shown().includes("yes, all green"), "the answer");

      feed("/mode off\r");
      await until(() => shown().includes("coordinator-only is off"), "the mode change");
      const after = await cli("-c", "tuitest", "--as", "lead", "mode");
      expect(after).toContain("normal");

      feed("\x03");
      feed("\x03");
      await running;
    } finally {
      process.env.KIWI_HOME = prior;
      if (prior === undefined) delete process.env.KIWI_HOME;
    }
  });
});
