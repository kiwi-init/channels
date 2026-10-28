import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipeFor } from "../src/loop/recipes.ts";
import { zcodeArgv, zcodeIdle, zcodeProcess, zcodeScreen, zcodeSession } from "../src/loop/zcode.ts";

const made: string[] = [];
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), "kiwi-zcode-loop-"));
  made.push(d);
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const READY_SCREEN = [
  "                                      ███████╗ ██████╗ ██████╗ ██████╗ ███████╗",
  " ╭─ Build ───────────────────────────────────────────────╮",
  " │ Type a prompt                                         │",
  " │ GLM-5.3 account:zai-individual-coding-plan | max      │",
  " ╰───────────────────────────────────────────────────────╯",
].join("\n");

function zcodeDbAt(dir: string) {
  const file = join(dir, "db.sqlite");
  const db = new Database(file);
  db.run("create table session (id text primary key, directory text not null, parent_id text, time_created integer not null, time_updated integer not null)");
  db.run("create table message (id text primary key, session_id text not null, time_created integer not null, data text not null)");
  db.run("create table part (id text primary key, message_id text not null, session_id text not null, data text not null)");
  db.run("create table turn_usage (session_id text not null, turn_id text not null, user_message_id text, status text not null, started_at integer not null, completed_at integer)");
  let n = 0;
  const say = (session: string, role: "user" | "assistant", at: number, text?: string) => {
    const id = `msg_${++n}`;
    db.run("insert into message values (?, ?, ?, ?)", [id, session, at, JSON.stringify({ role })]);
    if (text !== undefined) db.run("insert into part values (?, ?, ?, ?)", [`prt_${n}`, id, session, JSON.stringify({ type: "text", text })]);
    return id;
  };
  return {
    file,
    session: (id: string, directory: string, at: number, parent: string | null = null, updated = at) => db.run("insert into session values (?, ?, ?, ?, ?)", [id, directory, parent, at, updated]),
    part: (session: string, message: string, text: string) => db.run("insert into part values (?, ?, ?, ?)", [`prt_late_${message}`, message, session, JSON.stringify({ type: "text", text })]),
    say,
    turn: (session: string, asked: string | null, status: "completed" | "error" | "cancelled", started: number, ended: number) =>
      db.run("insert into turn_usage values (?, ?, ?, ?, ?, ?)", [session, `turn_${++n}`, asked, status, started, ended]),
    close: () => db.close(),
  };
}

describe("ZCode under kiwi loop", () => {
  test("its TUI takes no prompt on its command line; the loop types it once the prompt box shows", () => {
    expect(zcodeArgv({ bin: "/usr/local/bin/zcode-cli" })).toEqual(["/usr/local/bin/zcode-cli"]);
    expect(zcodeScreen(READY_SCREEN)).toBe("ready");
    expect(zcodeScreen("ZCode 0.17.0\nStatus\nStarting…")).toBe("starting");
    const recipe = recipeFor("zcode");
    expect(recipe.program).toBe("zcode-cli");
    expect(recipe.screen).toBe(zcodeScreen);
    expect(recipe.takesModel).toBe(false);
    expect(recipe.takesEffort).toBe(false);
    expect(recipe.stopSignal).toBe("SIGTERM");
    expect(recipe.firstLine).toContain("listen --once`, run_in_background: true, and no timeout");
  });

  test("the session is the top-level one in this folder, started since the launch, whose prompt carries the nonce", () => {
    const dir = scratch();
    const here = realpathSync(dir);
    const db = zcodeDbAt(dir);
    db.session("sess_old", here, 1_000);
    db.say("sess_old", "user", 1_010, "(Kiwi loop launch abc123)");
    db.session("sess_elsewhere", "/somewhere/else", 10_000);
    db.say("sess_elsewhere", "user", 10_010, "(Kiwi loop launch abc123)");
    db.session("sess_child", here, 10_000, "sess_new");
    db.say("sess_child", "user", 10_020, "(Kiwi loop launch abc123)");
    db.session("sess_other", here, 10_000);
    db.say("sess_other", "user", 10_030, "(Kiwi loop launch fff000)");
    expect(zcodeSession("abc123", 9_000, dir, db.file)).toBeNull();
    db.session("sess_new", here, 10_100);
    db.say("sess_new", "user", 10_110, "This session is for T7.\n\n(Kiwi loop launch abc123)");
    db.say("sess_new", "assistant", 10_120, "(Kiwi loop launch abc123)");
    expect(zcodeSession("abc123", 9_000, dir, db.file)).toBe("sess_new");
    expect(zcodeSession("abc123", 20_000, dir, db.file)).toBeNull();
    db.close();
    expect(zcodeSession("abc123", 9_000, dir, join(dir, "absent.sqlite"))).toBeNull();
  });

  test("binding waits for the prompt's text, which ZCode may write after its message", () => {
    const dir = scratch();
    const db = zcodeDbAt(dir);
    db.session("sess_late", realpathSync(dir), 10_000);
    const prompt = db.say("sess_late", "user", 10_010);
    expect(zcodeSession("abc123", 9_000, dir, db.file)).toBeNull();
    db.part("sess_late", prompt, "(Kiwi loop launch abc123)");
    expect(zcodeSession("abc123", 9_000, dir, db.file)).toBe("sess_late");
    db.close();
  });

  test("a turn is over when no user message is newer than its last turn's end, the synthetic one ZCode adds inside a turn included", () => {
    const dir = scratch();
    const here = realpathSync(dir);
    const db = zcodeDbAt(dir);
    expect(zcodeIdle(900, dir, db.file)).toEqual({ idle: true, since: null });
    db.session("sess_a", here, 1_000);
    expect(zcodeIdle(900, dir, db.file)).toEqual({ idle: true, since: null });
    const prompt = db.say("sess_a", "user", 1_010, "do it");
    db.say("sess_a", "user", 1_020, "Available agent types for the Agent tool: …");
    db.say("sess_a", "assistant", 1_030);
    expect(zcodeIdle(900, dir, db.file)).toEqual({ idle: false, since: null });
    db.turn("sess_a", prompt, "error", 1_000, 2_600);
    expect(zcodeIdle(900, dir, db.file)).toEqual({ idle: true, since: 2_600 });
    const next = db.say("sess_a", "user", 3_000, "and now this");
    expect(zcodeIdle(900, dir, db.file)).toEqual({ idle: false, since: 2_600 });
    db.turn("sess_a", next, "cancelled", 3_000, 3_500);
    expect(zcodeIdle(900, dir, db.file)).toEqual({ idle: true, since: 3_500 });
    const third = db.say("sess_a", "user", 4_000, "once more");
    db.turn("sess_a", third, "completed", 4_000, 5_000);
    expect(zcodeIdle(900, dir, db.file)).toEqual({ idle: true, since: 5_000 });
    db.close();
    expect(zcodeIdle(900, dir, join(dir, "absent.sqlite"))).toEqual({ idle: false, since: null });
  });

  test("after /new or /resume in the same ZCode, a busy session in this folder since the launch keeps it from counting as idle; other folders and older untouched sessions don't", () => {
    const dir = scratch();
    const here = realpathSync(dir);
    const db = zcodeDbAt(dir);
    db.session("sess_a", here, 10_000);
    const a = db.say("sess_a", "user", 10_010, "(Kiwi loop launch abc123)");
    db.turn("sess_a", a, "completed", 10_010, 11_000);
    expect(zcodeIdle(9_000, dir, db.file)).toEqual({ idle: true, since: 11_000 });
    db.session("sess_b", here, 12_000);
    db.say("sess_b", "user", 12_010, "carry on here");
    expect(zcodeIdle(9_000, dir, db.file)).toEqual({ idle: false, since: 11_000 });
    db.session("sess_elsewhere", "/somewhere/else", 12_000);
    db.say("sess_elsewhere", "user", 12_020, "busy elsewhere");
    db.session("sess_ancient", here, 1_000);
    db.say("sess_ancient", "user", 1_010, "never answered, long ago");
    db.session("sess_resumed", here, 2_000, null, 13_000);
    db.say("sess_resumed", "user", 13_000, "picked up again");
    expect(zcodeIdle(9_000, dir, db.file).idle).toBe(false);
    db.turn("sess_b", null, "completed", 12_010, 14_000);
    expect(zcodeIdle(9_000, dir, db.file).idle).toBe(false);
    db.turn("sess_resumed", null, "completed", 13_000, 15_000);
    expect(zcodeIdle(9_000, dir, db.file)).toEqual({ idle: true, since: 15_000 });
    db.close();
  });

  test("the seat is held by the process ZCode names zcode-cli: the node one under its launcher, not the launcher, fnm or its MCP servers", () => {
    const start = "Wed Oct 28 21:00:00 2026";
    const procs = [
      { pid: 100, ppid: 1, start, args: "/bin/sh -l -c exec zcode-cli" },
      { pid: 101, ppid: 100, start, args: "fnm exec --using /home/u/.zcode/runtime/current/.node-version node /home/u/.zcode/runtime/current/bin/zcode.mjs" },
      { pid: 102, ppid: 101, start, args: "zcode-cli" },
      { pid: 103, ppid: 102, start, args: "node /home/u/.zcode/runtime/current/agent/node_modules/mcp/server.js" },
      { pid: 200, ppid: 1, start, args: "zcode-cli" },
    ];
    expect(zcodeProcess(100, procs)).toBe(102);
    expect(zcodeProcess(102, procs)).toBe(102);
    expect(zcodeProcess(300, procs)).toBeNull();
    expect(zcodeProcess(103, procs)).toBeNull();
  });
});
