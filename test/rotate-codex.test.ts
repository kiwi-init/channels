import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/config.ts";
import { NEW_THREAD_MS, offerHandoff, takeHandoff } from "../src/hooks/handoff.ts";
import { CODEX_FIRST, codexInput, codexPane, codexPanes, codexShown, createdAt, sameWords, threadName } from "../src/rotate/codex.ts";
import { clearWhenIdle } from "../src/rotate/pane.ts";
import { kiwiCmd } from "./owner.ts";

const box = "\x1b[1m›\x1b[0m";
const composer = (rest: string) => `${box} ${rest}`;
const footer = ["", "  \x1b[38;5;223mGPT-6-Astra low\x1b[39m · \x1b[38;5;151m~/work\x1b[39m", "  \x1b[1m←\x1b[0m for agents · \x1b[1m?\x1b[0m for shortcuts"];
const screen = (...input: string[]) => ["\x1b[1;2m› \x1b[0man earlier prompt", "• an answer", "", ...input, ...footer].join("\n");

describe("Codex's input box", () => {
  test("empty when it shows only the dim placeholder or nothing, the draft otherwise", () => {
    expect(codexInput(screen(composer("\x1b[2mAsk Codex to do anything\x1b[0m")))).toBe("");
    expect(codexInput(screen(box))).toBe("");
    expect(codexInput(screen(composer("hello draft")))).toBe("hello draft");
    expect(codexInput(screen(composer("abc"), "  def"))).toBe("abc\ndef");
    expect(codexInput(screen("\x1b[1;7m› /new  \x1b[0;7mstart a new chat during a conversation\x1b[1m", "\x1b[0m", "\x1b[0;1m›\x1b[0m /new"))).toBe("/new");
  });

  test("a draft below blank lines is still a draft, and so is a draft of blank lines", () => {
    expect(codexInput(screen(box, "", "  personal draft"))).toBe("\n\npersonal draft");
    expect(codexInput(screen(composer("/new"), "", "  personal draft"))).not.toBe("/new");
    expect(codexInput(screen(box, ""))).toBe("\n");
  });

  test("a submitted prompt, a menu row or a screen without the footer is never read as the input box", () => {
    expect(codexInput(["\x1b[1;2m› \x1b[0man earlier prompt", "", ...footer].join("\n"))).toBeNull();
    expect(codexInput(["\x1b[1;7m› 1. Review hooks\x1b[0m", "  2. Trust all"].join("\n"))).toBeNull();
    expect(codexInput([composer("hello"), "", "  personal draft"].join("\n"))).toBeNull();
    expect(codexInput(screen(composer("\x1b[2mAsk\x1b[0m and more")))).not.toBe("");
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

  test("a thread id tells when the thread was created", () => {
    expect(createdAt("01a15a51-5d12-7090-b5d6-706401aee9ca")).toBe(0x01a15a515d12);
    expect(createdAt("thr-old")).toBeNull();
    expect(createdAt("01a15a51-5d12-4090-b5d6-706401aee9ca")).toBeNull();
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

  async function window(name: string, cwd: string, title: string): Promise<{ pane: string; pid: number; typed: string }> {
    mkdirSync(cwd, { recursive: true });
    const typed = join(dir, `${name}.typed`);
    const fake = join(dir, `${name}.sh`);
    writeFileSync(
      fake,
      [
        `title='${title}'`,
        "draw() { printf '\\033]2;%s\\033\\\\' \"$title\"; printf '\\033[2J\\033[H\\033[1;2m› \\033[0man earlier prompt\\n• an answer\\n\\n\\033[1m›\\033[0m \\n\\n  GPT-6-Astra low · ~/work\\n  \\033[1m←\\033[0m for agents\\033[4;3H'; }",
        "draw",
        `while IFS= read -r line; do printf '%s\\n' "$line" >> ${typed}; case "$line" in /new) title=work ;; *) title='Kiwi started | work' ;; esac; draw; done`,
      ].join("\n"),
    );
    spawnSync("tmux", ["-S", socket, "new-session", "-d", "-s", name, "-x", "120", "-y", "20", "-c", cwd, `exec ${join(dir, "bin", "codex")} ${fake}`]);
    const [id, pid] = spawnSync("tmux", ["-S", socket, "display-message", "-p", "-t", name, "#{pane_id} #{pane_pid}"], { encoding: "utf8" }).stdout.trim().split(" ");
    await Bun.sleep(300);
    return { pane: id!, pid: Number(pid), typed };
  }
  const rollout = (name: string, last: string) => {
    const file = join(dir, `${name}.jsonl`);
    writeFileSync(
      file,
      [
        { type: "session_meta", payload: { id: name, originator: "codex-tui" } },
        { type: "event_msg", payload: { type: "task_started" } },
        { type: "event_msg", payload: { type: last } },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n") + "\n",
    );
    return file;
  };
  const typedOf = (p: { typed: string }) => (existsSync(p.typed) ? readFileSync(p.typed, "utf8") : "");
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
    const thread = { kind: "old" as const, rollout: rollout("fresh", "task_complete"), name: "Old thread" };
    const outcome = await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-old", pane: p.pane, socket, cwd, thread }, fast);
    expect(outcome).toBe("cleared");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe(`/new\n${CODEX_FIRST}\n`);
    const offered = JSON.parse(readFileSync(offerFile(cwd), "utf8")) as { from: string; by: string };
    expect(offered).toMatchObject({ from: "thr-old", by: "codex-tui" });
    expect(readFileSync(join(dir, "kiwi", "rotate.log"), "utf8")).toContain(`pid ${p.pid} session thr-old pane ${p.pane}: cleared`);
  });

  test("a window showing another thread gets nothing", async () => {
    const cwd = join(dir, "elsewhere");
    const p = await window("elsewhere", cwd, "Something else | work");
    const thread = { kind: "old" as const, rollout: rollout("elsewhere", "task_complete"), name: "Old thread" };
    expect(await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-away", pane: p.pane, socket, cwd, thread }, fast)).toBe("not-its-thread");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe("");
    expect(existsSync(offerFile(cwd))).toBe(false);
  });

  test("a thread still at work gets nothing", async () => {
    const cwd = join(dir, "busy");
    const p = await window("busy", cwd, "Old thread | work");
    const thread = { kind: "old" as const, rollout: rollout("busy", "agent_reasoning"), name: "Old thread" };
    expect(await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-busy", pane: p.pane, socket, cwd, thread }, fast)).toBe("timed-out");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe("");
    expect(existsSync(offerFile(cwd))).toBe(false);
  });
});

const v7 = (ms: number) => {
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7abc-8def-0123456789ab`;
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
  const started = (name: string, originator: string) => {
    const file = join(dir, `${name}.jsonl`);
    writeFileSync(file, JSON.stringify({ type: "session_meta", payload: { id: name, originator } }) + "\n");
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
    mkdirSync(folder);
    bind(folder);
    const at = 1_800_000_000_000;
    const tui = started("tui", "codex-tui");
    expect(takeHandoff(folder, v7(at + 1_000), tui)).toBeNull();
    offerHandoff(folder, "thr-old", "codex-tui", at);
    expect(takeHandoff(folder, v7(at - 60_000), tui)).toBeNull();
    expect(takeHandoff(folder, v7(at + NEW_THREAD_MS + 1), tui)).toBeNull();
    expect(takeHandoff(folder, v7(at + 1_000), started("exec", "codex_exec"))).toBeNull();
    expect(takeHandoff(folder, "thr-old", tui)).toBeNull();
    expect(seats(folder).map((b) => b.session)).toEqual(["thr-old", "thr-old"]);
    const mine = v7(at + 1_000);
    expect(takeHandoff(folder, mine, tui)).toBe("thr-old");
    expect(seats(folder).map((b) => [b.as, b.session])).toEqual([
      ["ana", mine],
      ["bo", "thr-old"],
    ]);
    expect(takeHandoff(folder, v7(at + 2_000), tui)).toBeNull();
    expect(seats(folder)[0]?.session).toBe(mine);
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
      stdin: new TextEncoder().encode(JSON.stringify({ session_id: fresh, transcript_path: started("hooked", "codex-tui"), cwd: folder, hook_event_name: "SessionStart", source: "startup" })),
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
