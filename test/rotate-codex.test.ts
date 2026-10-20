import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/config.ts";
import { HANDOFF_MS, offerHandoff, takeHandoff } from "../src/hooks/handoff.ts";
import { CODEX_FIRST, codexInput, codexPane, codexPanes } from "../src/rotate/codex.ts";
import { clearWhenIdle } from "../src/rotate/pane.ts";

const composer = (rest: string) => `\x1b[1m›\x1b[0m ${rest}`;
const footer = ["", "  \x1b[38;5;223mGPT-6-Astra low\x1b[39m · ~/work", "  \x1b[1m←\x1b[0m for agents · \x1b[1m?\x1b[0m for shortcuts"];
const screen = (...input: string[]) => ["\x1b[1;2m› \x1b[0man earlier prompt", "• an answer", "", ...input, ...footer].join("\n");

describe("Codex's input box", () => {
  test("empty when it shows only the dim placeholder or nothing, the draft otherwise", () => {
    expect(codexInput(screen(composer("\x1b[2mAsk Codex to do anything\x1b[0m")))).toBe("");
    expect(codexInput(screen("\x1b[1m›\x1b[0m"))).toBe("");
    expect(codexInput(screen(composer("hello draft")))).toBe("hello draft");
    expect(codexInput(screen(composer("first line"), "    second line"))).toBe("first line\nsecond line");
    expect(codexInput(screen("\x1b[1;7m› /new  \x1b[0;7mstart a new chat\x1b[1m", "\x1b[0;1m›\x1b[0m /new"))).toBe("/new");
  });

  test("a submitted prompt or a menu row is never the input box, and no box at all reads as unknown", () => {
    expect(codexInput(["\x1b[1;2m› \x1b[0man earlier prompt", "", ...footer].join("\n"))).toBeNull();
    expect(codexInput(["\x1b[1;7m› 1. Review hooks\x1b[0m", "  2. Trust all"].join("\n"))).toBeNull();
    expect(codexInput(screen(composer("\x1b[2mAsk\x1b[0m and more")))).not.toBe("");
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

  async function window(name: string, cwd: string): Promise<{ pane: string; pid: number; typed: string }> {
    mkdirSync(cwd, { recursive: true });
    const typed = join(dir, `${name}.typed`);
    const fake = join(dir, `${name}.sh`);
    writeFileSync(
      fake,
      [
        "draw() { printf '\\033[2J\\033[H\\033[1;2m› \\033[0man earlier prompt\\n• an answer\\n\\n\\033[1m›\\033[0m \\n\\n  GPT-6-Astra low · ~/work\\n  \\033[1m←\\033[0m for agents\\033[4;3H'; }",
        "draw",
        `while IFS= read -r line; do printf '%s\\n' "$line" >> ${typed}; draw; done`,
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
        { type: "event_msg", payload: { type: "task_started" } },
        { type: "event_msg", payload: { type: last } },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n") + "\n",
    );
    return file;
  };
  const typedOf = (p: { typed: string }) => (existsSync(p.typed) ? readFileSync(p.typed, "utf8") : "");
  const fast = { timeoutMs: 1_500, everyMs: 100, quietMs: 0 };

  test("found by the folder it has open, and only when exactly one window has it open", async () => {
    const work = join(dir, "work");
    const p = await window("one", work);
    expect(codexPanes(work, [socket])).toEqual([{ pid: p.pid, pane: p.pane, socket }]);
    expect(codexPane(work, [socket])).toEqual({ pid: p.pid, pane: p.pane, socket });
    expect(codexPane(dir, [socket])).toBeNull();
    expect(codexPane(join(dir, "nowhere"), [socket])).toBeNull();
    await window("two", work);
    expect(codexPanes(work, [socket])).toHaveLength(2);
    expect(codexPane(work, [socket])).toBeNull();
  });

  test("an idle thread gets /new, then the first prompt that starts its new thread, and the seat is offered to that thread", async () => {
    const cwd = join(dir, "fresh");
    const p = await window("fresh", cwd);
    const outcome = await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-old", pane: p.pane, socket, rollout: rollout("fresh", "task_complete"), cwd }, fast);
    expect(outcome).toBe("cleared");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe(`/new\n${CODEX_FIRST}\n`);
    const offered = JSON.parse(readFileSync(join(dir, "kiwi", "hook-state", `codex-handoff.${encodeURIComponent(realpathSync(cwd))}`), "utf8")) as { from: string };
    expect(offered.from).toBe("thr-old");
    expect(readFileSync(join(dir, "kiwi", "rotate.log"), "utf8")).toContain(`pid ${p.pid} session thr-old pane ${p.pane}: cleared`);
  });

  test("a thread still at work gets nothing", async () => {
    const cwd = join(dir, "busy");
    const p = await window("busy", cwd);
    expect(await clearWhenIdle({ harness: "codex", pid: p.pid, session: "thr-busy", pane: p.pane, socket, rollout: rollout("busy", "agent_reasoning"), cwd }, fast)).toBe("timed-out");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe("");
    expect(existsSync(join(dir, "kiwi", "hook-state", `codex-handoff.${encodeURIComponent(realpathSync(cwd))}`))).toBe(false);
  });
});

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

  test("the thread that starts in the offered folder takes the old thread's Codex seats once, within the window", () => {
    const folder = join(dir, "work");
    mkdirSync(folder);
    updateConfig((c) => {
      c.bindings = {
        [folder]: [
          { alias: "dev", as: "ana", harness: "codex", session: "thr-old", at: 1, seen: 1 },
          { alias: "dev", as: "bo", harness: "claude", session: "thr-old", pid: 7, at: 1, seen: 1 },
        ],
      };
    });
    expect(takeHandoff(folder, "thr-new")).toBeNull();
    offerHandoff(folder, "thr-old", 1_000);
    expect(takeHandoff(folder, "thr-new", 1_000 + HANDOFF_MS + 1)).toBeNull();
    offerHandoff(folder, "thr-old", 1_000);
    expect(takeHandoff(folder, "thr-old", 2_000)).toBeNull();
    offerHandoff(folder, "thr-old", 1_000);
    expect(takeHandoff(folder, "thr-new", 2_000)).toBe("thr-old");
    expect(seats(folder).map((b) => [b.as, b.session])).toEqual([
      ["ana", "thr-new"],
      ["bo", "thr-old"],
    ]);
    expect(takeHandoff(folder, "thr-newer", 3_000)).toBeNull();
    expect(seats(folder)[0]?.session).toBe("thr-new");
  });
});
