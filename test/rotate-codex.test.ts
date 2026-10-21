import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/config.ts";
import { NEW_THREAD_MS, offerHandoff, takeHandoff } from "../src/hooks/handoff.ts";
import { CODEX_FIRST, codexInput, codexPane, codexPanes, codexShown, createdAt, sameWords, sessionMeta, threadName, threadOf } from "../src/rotate/codex.ts";
import { clearWhenIdle } from "../src/rotate/pane.ts";
import { kiwiCmd } from "./owner.ts";

const WORK = join(homedir(), "work");
const VM = "/home/www/inquizit";
const box = "\x1b[1m›\x1b[0m";
const composer = (rest: string) => `${box} ${rest}`;
const footer = ["", "  \x1b[38;5;223mGPT-6-Astra low\x1b[39m · \x1b[38;5;151m~/work\x1b[39m", "  \x1b[1m←\x1b[0m for agents · \x1b[1m?\x1b[0m for shortcuts"];
const screen = (...input: string[]) => ["\x1b[1;2m› \x1b[0man earlier prompt", "• an answer", "", ...input, ...footer].join("\n");

const BG = "\x1b[48;2;61;64;64m";
const vmFooter = [
  "",
  "\x1b[49m  \x1b[38;2;246;226;183mGPT-6-Astra medium\x1b[38;2;165;166;166m · \x1b[38;2;171;223;167m/home/www/inquizit\x1b[38;2;165;166;166m · \x1b[38;2;166;227;161mJoin review room\x1b[39m",
  "  \x1b[1m\x1b[38;2;252;252;252m←\x1b[0m\x1b[38;2;165;166;166m for agents · \x1b[1m\x1b[38;2;252;252;252m?\x1b[0m\x1b[38;2;165;166;166m for shortcuts\x1b[39m",
  "",
];
const vmScreen = (...input: string[]) =>
  ["\x1b[1;2m› \x1b[0m\x1b[48;2;70;72;73mNew Kiwi messages for you.", "", "\x1b[49m", "\x1b[2m• \x1b[0mDone.", "", `\x1b[0m${BG}`, ...input, ...vmFooter].join("\n");

const boxOf = (cwd: string, captured: string) => codexInput(captured, cwd);

describe("Codex's input box", () => {
  test("empty when it shows only the dim placeholder or nothing, the draft otherwise", () => {
    expect(boxOf(WORK, screen(composer("\x1b[2mAsk Codex to do anything\x1b[0m")))).toBe("");
    expect(boxOf(WORK, screen(box))).toBe("");
    expect(boxOf(WORK, screen(composer("hello draft")))).toBe("hello draft");
    expect(boxOf(WORK, screen(composer("abc"), "  def"))).toBe("abc\ndef");
    expect(boxOf(WORK, screen("\x1b[1;7m› /new  \x1b[0;7mstart a new chat during a conversation\x1b[1m", "\x1b[0m", "\x1b[0;1m›\x1b[0m /new"))).toBe("/new");
  });

  test("read the same in a truecolor terminal, where the box has a background color", () => {
    expect(boxOf(VM, vmScreen(`${box}${BG} \x1b[2mAsk Codex to do anything\x1b[0m${BG}`))).toBe("");
    expect(boxOf(VM, vmScreen(`${box}${BG} /new\x1b[0m${BG}`))).toBe("/new");
    expect(boxOf(VM, vmScreen(`${box}${BG} abc\x1b[0m${BG}`, `${BG}  def\x1b[0m`))).toBe("abc\ndef");
  });

  test("a draft below blank lines is still a draft, and so is a draft of blank lines", () => {
    expect(boxOf(WORK, screen(box, "", "  personal draft"))).toBe("\n\npersonal draft");
    expect(boxOf(WORK, screen(composer("/new"), "", "  personal draft"))).not.toBe("/new");
    expect(boxOf(WORK, screen(box, ""))).toBe("\n");
  });

  test("a submitted prompt, a menu row, or a screen whose last block isn't the colored footer is never read as the input box", () => {
    expect(boxOf(WORK, ["\x1b[1;2m› \x1b[0man earlier prompt", "", ...footer].join("\n"))).toBeNull();
    expect(boxOf(WORK, ["\x1b[1;7m› 1. Review hooks\x1b[0m", "  2. Trust all"].join("\n"))).toBeNull();
    expect(boxOf(WORK, [composer("hello"), "", "  personal draft"].join("\n"))).toBeNull();
    expect(boxOf(WORK, [box, "", "  a · personal draft"].join("\n"))).toBeNull();
    expect(boxOf(WORK, [box, "", "  notes · \x1b[36m[Pasted Content 1234 chars]\x1b[39m"].join("\n"))).toBeNull();
    expect(boxOf(WORK, [box, "", "  notes · \x1b[36m~/work\x1b[39m personal text"].join("\n"))).toBeNull();
    expect(boxOf(WORK, [box, "", "  ~/work and \x1b[36m~/work\x1b[39m · notes"].join("\n"))).toBeNull();
    expect(boxOf(join(homedir(), "elsewhere"), screen(box))).toBeNull();
    expect(boxOf(VM, screen(box))).toBeNull();
    expect(boxOf(WORK, screen(composer("\x1b[2mAsk\x1b[0m and more")))).not.toBe("");
  });

  test("a first prompt wrapped across rows still reads as the first prompt", () => {
    expect(sameWords("Kiwi started this fresh session; carry\non from above.", CODEX_FIRST)).toBe(true);
    expect(sameWords("\nKiwi started this fresh session; carry on from above.", CODEX_FIRST)).toBe(false);
  });
});

describe("which thread a Codex window shows", () => {
  test("its title names the thread when idle, only the folder for a fresh thread, and spins while working", () => {
    expect(codexShown("Continue prior session | work")).toEqual({ kind: "named", name: "Continue prior session" });
    expect(codexShown("Join review room | inquizit")).toEqual({ kind: "named", name: "Join review room" });
    expect(codexShown("work")).toEqual({ kind: "unnamed" });
    expect(codexShown("⠧ Run sleep command | work")).toEqual({ kind: "busy" });
    expect(codexShown("⠧ ⠧ | work")).toEqual({ kind: "busy" });
  });

  test("a thread's name is its latest row in the session index", () => {
    const home = mkdtempSync(join(tmpdir(), "kiwi-codex-index-"));
    try {
      expect(threadName(home, "t1")).toBeNull();
      writeFileSync(
        join(home, "session_index.jsonl"),
        [
          { id: "t1", thread_name: "First" },
          { id: "t2", thread_name: "Other" },
          { id: "t1", thread_name: "Renamed" },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n") + '\n{"id":"t1","thread_na',
      );
      expect(threadName(home, "t1")).toBe("Renamed");
      expect(threadName(home, "t3")).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a thread id tells when the thread was created, and a rollout's name and first line which thread it is", () => {
    expect(createdAt("01a15a51-5d12-7090-b5d6-706401aee9ca")).toBe(0x01a15a515d12);
    expect(createdAt("thr-old")).toBeNull();
    expect(createdAt("01a15a51-5d12-4090-b5d6-706401aee9ca")).toBeNull();
    expect(threadOf("rollout-2026-10-20T14-17-24-01a15a51-5d12-7090-b5d6-706401aee9ca.jsonl")).toBe("01a15a51-5d12-7090-b5d6-706401aee9ca");
    expect(threadOf("rollout-2026-10-20T14-17-24-01a15a51-5d12-4090-b5d6-706401aee9ca.jsonl")).toBeNull();
    const home = mkdtempSync(join(tmpdir(), "kiwi-codex-meta-"));
    try {
      const file = join(home, "r.jsonl");
      writeFileSync(file, JSON.stringify({ type: "session_meta", payload: { originator: "codex-tui", cwd: "/w", base_instructions: "x".repeat(100_000) } }) + "\n{}\n");
      expect(sessionMeta(file)).toEqual({ originator: "codex-tui", cwd: "/w" });
      writeFileSync(file, JSON.stringify({ type: "event_msg", payload: {} }) + "\n");
      expect(sessionMeta(file)).toBeNull();
      writeFileSync(file, '{"type":"session_meta"');
      expect(sessionMeta(file)).toBeNull();
      expect(sessionMeta(join(home, "none.jsonl"))).toBeNull();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

const hasTmux = spawnSync("tmux", ["-V"]).status === 0;
const bash = spawnSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).stdout.trim();

describe.skipIf(!hasTmux || !bash)("a Codex window in tmux", () => {
  let dir = "";
  let socket = "";
  let was: string | undefined;
  beforeAll(() => {
    was = process.env.KIWI_HOME;
    dir = mkdtempSync(join(tmpdir(), "kiwi-codex-"));
    socket = join(dir, "tmux.sock");
    process.env.KIWI_HOME = join(dir, "kiwi");
    mkdirSync(join(dir, "bin"));
    symlinkSync(bash, join(dir, "bin", "codex"));
  });
  afterAll(() => {
    spawnSync("tmux", ["-S", socket, "kill-server"]);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    rmSync(dir, { recursive: true, force: true });
  });

  type Window = { pane: string; pid: number; typed: string; state: string };

  async function window(name: string, cwd: string, title: string, switchAt = ""): Promise<Window> {
    mkdirSync(cwd, { recursive: true });
    const typed = join(dir, `${name}.typed`);
    const state = join(dir, `${name}.state`);
    const fake = join(import.meta.dir, "fixtures", "fake-codex.sh");
    const command = [join(dir, "bin", "codex"), fake, typed, state, title, switchAt].map((a) => `'${a}'`).join(" ");
    spawnSync("tmux", ["-f", "/dev/null", "-S", socket, "new-session", "-d", "-s", name, "-x", "120", "-y", "20", "-c", cwd, `exec ${command}`]);
    const [id, pid] = spawnSync("tmux", ["-S", socket, "display-message", "-p", "-t", name, "#{pane_id} #{pane_pid}"], { encoding: "utf8" }).stdout.trim().split(" ");
    await Bun.sleep(300);
    return { pane: id!, pid: Number(pid), typed, state };
  }
  const rollout = (name: string, last: string) => {
    const file = join(dir, `${name}.jsonl`);
    writeFileSync(
      file,
      [
        { type: "session_meta", payload: { id: name, originator: "codex-tui", cwd: dir } },
        { type: "event_msg", payload: { type: "task_started" } },
        { type: "event_msg", payload: { type: last } },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n") + "\n",
    );
    return file;
  };
  const old = (name: string, last = "task_complete") => ({ kind: "old" as const, rollout: rollout(name, last), name: "Old thread", by: "codex-tui" });
  const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
  const offerFile = (cwd: string) => join(dir, "kiwi", "hook-state", `codex-handoff.${encodeURIComponent(realpathSync(cwd))}`);
  const fast = { timeoutMs: 1_500, everyMs: 100, quietMs: 0 };

  test("found by the folder it has open, and only when exactly one window has it open", async () => {
    const work = join(dir, "work");
    const p = await window("one", work, "Old thread | work");
    expect(codexPanes(work, [socket])).toEqual([{ pid: p.pid, pane: p.pane, socket }]);
    expect(codexPane(work, [socket])).toEqual({ pid: p.pid, pane: p.pane, socket });
    expect(codexPane(dir, [socket])).toBeNull();
    expect(codexPane(join(dir, "nowhere"), [socket])).toBeNull();
    await window("two", work, "Old thread | work");
    expect(codexPanes(work, [socket])).toHaveLength(2);
    expect(codexPane(work, [socket])).toBeNull();
  });

  test("an idle thread gets /new, then the first prompt that starts its new thread, and the seat is offered to that thread", async () => {
    const cwd = join(dir, "fresh");
    const p = await window("fresh", cwd, "Old thread | work");
    const outcome = await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-old", pane: p.pane, socket, cwd, thread: old("fresh") }, fast);
    expect(outcome).toBe("cleared");
    await Bun.sleep(300);
    expect(read(p.typed)).toBe(`/new\n${CODEX_FIRST}\n`);
    const offered = JSON.parse(readFileSync(offerFile(cwd), "utf8")) as { from: string; by: string };
    expect(offered).toMatchObject({ from: "thr-old", by: "codex-tui" });
    expect(readFileSync(join(dir, "kiwi", "rotate.log"), "utf8")).toContain(`pid ${p.pid} session thr-old pane ${p.pane}: cleared`);
  });

  test("a window showing another thread gets nothing", async () => {
    const cwd = join(dir, "elsewhere");
    const p = await window("elsewhere", cwd, "Something else | work");
    expect(await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-away", pane: p.pane, socket, cwd, thread: old("elsewhere") }, fast)).toBe("not-its-thread");
    await Bun.sleep(300);
    expect(read(p.typed)).toBe("");
    expect(read(p.state)).toBe("");
    expect(existsSync(offerFile(cwd))).toBe(false);
  });

  test("a window that turns to another thread after /new is typed gets no more keys, not even the erase", async () => {
    const cwd = join(dir, "turned");
    const p = await window("turned", cwd, "Old thread | work", "/new");
    expect(await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-turned", pane: p.pane, socket, cwd, thread: old("turned") }, fast)).toBe("not-its-thread");
    await Bun.sleep(300);
    expect(read(p.state)).toBe("/new");
    expect(read(p.typed)).toBe("");
    expect(existsSync(offerFile(cwd))).toBe(false);
  });

  test("rotation switched off after /new is typed, in a window turned to another thread, leaves the box as it is", async () => {
    const cwd = join(dir, "turned-off");
    const p = await window("turned-off", cwd, "Old thread | work", "/new");
    let checks = 0;
    const on = () => checks++ < 1;
    expect(await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-off", pane: p.pane, socket, cwd, thread: old("turned-off") }, { ...fast, on })).toBe("left-in-input");
    await Bun.sleep(300);
    expect(read(p.state)).toBe("/new");
    expect(read(p.typed)).toBe("");
  });

  test("kiwi rotate send types nothing for a Codex thread whose rollout has no session_meta, and rotates one that has it", async () => {
    updateConfig((c) => {
      c.rotate = "on";
    });
    const send = async (name: string, rolloutFile: string) => {
      const cwd = join(dir, name);
      const p = await window(name, cwd, "Old thread | work");
      const run = Bun.spawn(kiwiCmd(["rotate", "send", String(p.pid), `thr-${name}`, p.pane, socket, "codex", rolloutFile, cwd, "Old thread"]), {
        env: { ...process.env, KIWI_HOME: join(dir, "kiwi") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await run.exited;
      await Bun.sleep(300);
      return { code, typed: read(p.typed), state: read(p.state) };
    };
    const bare = join(dir, "bare.jsonl");
    writeFileSync(bare, JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }) + "\n");
    expect(await send("bare", bare)).toEqual({ code: 1, typed: "", state: "" });
    expect(await send("metered", rollout("metered", "task_complete"))).toEqual({ code: 0, typed: `/new\n${CODEX_FIRST}\n`, state: "" });
  });

  test("a thread still at work gets nothing", async () => {
    const cwd = join(dir, "busy");
    const p = await window("busy", cwd, "Old thread | work");
    expect(await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-busy", pane: p.pane, socket, cwd, thread: old("busy", "agent_reasoning") }, fast)).toBe("timed-out");
    await Bun.sleep(300);
    expect(read(p.typed)).toBe("");
    expect(read(p.state)).toBe("");
    expect(existsSync(offerFile(cwd))).toBe(false);
  });
});

const v7 = (ms: number, tail = "0123456789ab") => {
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7abc-8def-${tail}`;
};

describe("handing a Codex seat to its new thread", () => {
  let dir = "";
  let was: string | undefined;
  beforeAll(() => {
    was = process.env.KIWI_HOME;
    dir = mkdtempSync(join(tmpdir(), "kiwi-handoff-"));
    process.env.KIWI_HOME = dir;
  });
  afterAll(() => {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    rmSync(dir, { recursive: true, force: true });
  });
  const seats = (folder: string) => {
    const v = loadConfig().bindings?.[folder];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  const started = (sessions: string, id: string, originator: string, cwd: string) => {
    mkdirSync(sessions, { recursive: true });
    const file = join(sessions, `rollout-2026-10-20T14-17-24-${id}.jsonl`);
    writeFileSync(file, JSON.stringify({ type: "session_meta", payload: { id, originator, cwd } }) + "\n");
    return file;
  };
  const bind = (folder: string) =>
    updateConfig((c) => {
      c.bindings = {
        [folder]: [
          { alias: "dev", as: "ana", harness: "codex", session: "thr-old", at: 1, seen: 1 },
          { alias: "dev", as: "bo", harness: "claude", session: "thr-old", pid: 7, at: 1, seen: 1 },
        ],
      };
    });

  test("only a window thread created right after the offer takes the old thread's Codex seats, once", () => {
    const folder = join(dir, "work");
    const sessions = join(dir, "sessions-a");
    mkdirSync(folder);
    bind(folder);
    const at = 1_800_000_000_000;
    const mine = v7(at + 1_000);
    const tui = started(sessions, mine, "codex-tui", folder);
    expect(takeHandoff(folder, mine, tui)).toBeNull();
    offerHandoff(folder, "thr-old", "codex-tui", at);
    const early = v7(at - 60_000);
    const late = v7(at + NEW_THREAD_MS + 1);
    const exec = v7(at + 1_500, "0000000000e1");
    expect(takeHandoff(folder, early, started(sessions, early, "codex-tui", folder))).toBeNull();
    expect(takeHandoff(folder, late, started(sessions, late, "codex-tui", folder))).toBeNull();
    expect(takeHandoff(folder, exec, started(sessions, exec, "codex_exec", folder))).toBeNull();
    expect(takeHandoff(folder, "thr-old", tui)).toBeNull();
    mkdirSync(join(dir, "another-folder"));
    started(sessions, v7(at + 2_000, "0000000000f1"), "codex-tui", join(dir, "another-folder"));
    expect(seats(folder).map((b) => b.session)).toEqual(["thr-old", "thr-old"]);
    expect(takeHandoff(folder, mine, tui)).toBe("thr-old");
    expect(seats(folder).map((b) => [b.as, b.session])).toEqual([
      ["ana", mine],
      ["bo", "thr-old"],
    ]);
    expect(takeHandoff(folder, mine, tui)).toBeNull();
    expect(seats(folder)[0]?.session).toBe(mine);
  });

  test("when two window threads start in the folder right after the offer, neither takes the seats", () => {
    const folder = join(dir, "crowded");
    const sessions = join(dir, "sessions-b");
    mkdirSync(folder);
    bind(folder);
    const at = 1_800_000_100_000;
    offerHandoff(folder, "thr-old", "codex-tui", at);
    const theirs = v7(at + 3_000, "0000000000a1");
    const mine = v7(at + 1_000, "0000000000b1");
    const theirFile = started(sessions, theirs, "codex-tui", folder);
    const myFile = started(sessions, mine, "codex-tui", folder);
    expect(takeHandoff(folder, theirs, theirFile)).toBeNull();
    expect(takeHandoff(folder, mine, myFile)).toBeNull();
    expect(seats(folder).map((b) => b.session)).toEqual(["thr-old", "thr-old"]);
    expect(readFileSync(join(dir, "rotate.log"), "utf8")).toContain("session thr-old stays: 2 Codex threads started");
  });

  test("a thread created in the window whose rollout can't be read yet counts as another one", () => {
    const folder = join(dir, "unread");
    const sessions = join(dir, "sessions-d");
    mkdirSync(folder);
    bind(folder);
    const at = 1_800_000_200_000;
    offerHandoff(folder, "thr-old", "codex-tui", at);
    const mine = v7(at + 1_000, "0000000000c1");
    const myFile = started(sessions, mine, "codex-tui", folder);
    writeFileSync(join(sessions, `rollout-2026-10-20T14-17-25-${v7(at + 2_000, "0000000000d1")}.jsonl`), '{"type":"session_meta","payload":{"id":');
    expect(takeHandoff(folder, mine, myFile)).toBeNull();
    expect(seats(folder).map((b) => b.session)).toEqual(["thr-old", "thr-old"]);
  });

  test("a thread started in the same folder under another spelling of it counts as another one", () => {
    const folder = join(dir, "aliased");
    const sessions = join(dir, "sessions-e");
    mkdirSync(folder);
    symlinkSync(folder, join(dir, "alias"));
    bind(folder);
    const spellings = [join(dir, "alias"), `${folder}/`];
    spellings.forEach((other, i) => {
      const at = 1_800_000_300_000 + i * 100_000;
      offerHandoff(folder, "thr-old", "codex-tui", at);
      const mine = v7(at + 1_000, `00000000010${i}`);
      const myFile = started(sessions, mine, "codex-tui", folder);
      started(sessions, v7(at + 2_000, `00000000020${i}`), "codex-tui", other);
      expect(takeHandoff(folder, mine, myFile)).toBeNull();
    });
    expect(seats(folder).map((b) => b.session)).toEqual(["thr-old", "thr-old"]);
  });

  test("a Codex SessionStart for the new thread moves the seat", async () => {
    const folder = join(dir, "hooked");
    mkdirSync(folder);
    bind(folder);
    const at = Date.now();
    offerHandoff(folder, "thr-old", "codex-tui", at);
    const fresh = v7(at + 500);
    const p = Bun.spawn(kiwiCmd(["--harness", "codex", "hook", "session-start"]), {
      cwd: folder,
      env: { ...process.env, KIWI_HOME: dir, KIWI_NO_HOOKS: "1", CLAUDE_CONFIG_DIR: join(dir, "claude"), CLAUDE_PROJECT_DIR: "", CODEX_THREAD_ID: fresh },
      stdin: new TextEncoder().encode(
        JSON.stringify({ session_id: fresh, transcript_path: started(join(dir, "sessions-c"), fresh, "codex-tui", folder), cwd: folder, hook_event_name: "SessionStart", source: "startup" }),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await p.exited).toBe(0);
    expect(seats(folder).map((b) => [b.as, b.session])).toEqual([
      ["ana", fresh],
      ["bo", "thr-old"],
    ]);
  });
});
