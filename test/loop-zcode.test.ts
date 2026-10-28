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
  db.run("create table session (id text primary key, directory text not null, parent_id text, time_created integer not null)");
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
    session: (id: string, directory: string, at: number, parent: string | null = null) => db.run("insert into session values (?, ?, ?, ?)", [id, directory, parent, at]),
    say,
    turn: (session: string, asked: string, status: "completed" | "error" | "cancelled", started: number, ended: number) =>
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

  test("a turn is over when no user message is newer than its last turn's end, the synthetic one ZCode adds inside a turn included", () => {
    const dir = scratch();
    const db = zcodeDbAt(dir);
    db.session("sess_a", dir, 1_000);
    expect(zcodeIdle("sess_a", db.file)).toEqual({ idle: true, since: null });
    const prompt = db.say("sess_a", "user", 1_010, "do it");
    db.say("sess_a", "user", 1_020, "Available agent types for the Agent tool: …");
    db.say("sess_a", "assistant", 1_030);
    expect(zcodeIdle("sess_a", db.file)).toEqual({ idle: false, since: null });
    db.turn("sess_a", prompt, "error", 1_000, 2_600);
    expect(zcodeIdle("sess_a", db.file)).toEqual({ idle: true, since: 2_600 });
    const next = db.say("sess_a", "user", 3_000, "and now this");
    expect(zcodeIdle("sess_a", db.file)).toEqual({ idle: false, since: 2_600 });
    db.turn("sess_a", next, "completed", 3_000, 4_000);
    expect(zcodeIdle("sess_a", db.file)).toEqual({ idle: true, since: 4_000 });
    db.close();
    expect(zcodeIdle("sess_a", join(dir, "absent.sqlite"))).toEqual({ idle: false, since: null });
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
