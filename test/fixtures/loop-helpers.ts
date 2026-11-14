import { Database } from "bun:sqlite";
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { runNow, tmuxNow } from "../../src/loop/tmux.ts";

type Env = Record<string, string | undefined>;
const TAIL_BYTES = 64 * 1024;

export const LOOP_HELPER_BASE = "420174af98030122ec9dc1e2afd54573076e24b2";

export interface Proc {
  pid: number;
  ppid: number;
  start: string;
  args: string;
}

export function names(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // No rollout written on that day yet.
    return [];
  }
}

export function holds(file: string, nonce: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(nonce);
  } catch {
    // Gone or unreadable between the listing and the read: not this launch's thread.
    return false;
  }
}

export function tail(file: string): string[] {
  let fd: number | null = null;
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    fd = openSync(file, "r");
    readSync(fd, buf, 0, buf.length, from);
    const lines = buf.toString("utf8").split("\n");
    return from > 0 ? lines.slice(1) : lines;
  } catch {
    // No update stream yet: nothing to read a turn from.
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function realDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    // A folder that can't be resolved is matched as given.
    return dir;
  }
}

export function paneText(socket: string, pane: string): string {
  return tmuxNow(socket, ["capture-pane", "-p", "-t", pane]) ?? "";
}

export function typeInto(socket: string, pane: string, text: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-loop-"));
  const buffer = `kiwi-loop-${process.pid}`;
  try {
    const file = join(dir, "prompt.txt");
    writeFileSync(file, text, { mode: 0o600 });
    if (tmuxNow(socket, ["load-buffer", "-b", buffer, file]) === null) return false;
    if (tmuxNow(socket, ["paste-buffer", "-p", "-d", "-b", buffer, "-t", pane]) === null) return false;
    return tmuxNow(socket, ["send-keys", "-t", pane, "Enter"]) !== null;
  } finally {
    tmuxNow(socket, ["delete-buffer", "-b", buffer]);
    rmSync(dir, { recursive: true, force: true });
  }
}

export function pasteBracketed(socket: string, pane: string): boolean {
  return tmuxNow(socket, ["display-message", "-p", "-t", pane, "#{bracket_paste_flag}"])?.trim() === "1";
}

export function clearPane(socket: string, pane: string): void {
  tmuxNow(socket, ["send-keys", "-R", "-t", pane]);
  tmuxNow(socket, ["clear-history", "-t", pane]);
}

export function paneIsOurs(socket: string, pane: string, procs: readonly Proc[] = processes()): boolean {
  const panePid = Number(tmuxNow(socket, ["display-message", "-p", "-t", pane, "#{pane_pid}"])?.trim());
  if (!Number.isInteger(panePid) || panePid <= 1) return false;
  const parent = new Map(procs.map((p) => [p.pid, p.ppid]));
  for (let pid: number | undefined = process.pid, hops = 0; pid !== undefined && pid > 1 && hops < 64; pid = parent.get(pid), hops++) {
    if (pid === panePid) return true;
  }
  return false;
}

export function processes(): Proc[] {
  const r = runNow(["env", "LC_ALL=C", "TZ=UTC0", "ps", "-eo", "pid=,ppid=,lstart=,args="], 5_000);
  if (r.status !== 0) return [];
  return r.stdout.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), start: m[3]!, args: m[4]! }] : [];
  });
}

export function mimoRoot(kind: "data" | "state", env: Env): string {
  if (env.MIMOCODE_HOME && isAbsolute(env.MIMOCODE_HOME)) return join(env.MIMOCODE_HOME, kind);
  const xdg = kind === "data" ? env.XDG_DATA_HOME : env.XDG_STATE_HOME;
  return join(xdg || join(homedir(), ".local", kind === "data" ? "share" : "state"), "mimocode");
}

export function mimoWithDb<A>(env: Env, read: (db: Database) => A, none: A): A {
  const file = join(mimoRoot("data", env), "mimocode.db");
  if (!existsSync(file)) return none;
  let db: Database | null = null;
  try {
    db = new Database(file, { readonly: true });
    return read(db);
  } catch {
    // MiMoCode is migrating or writing its database: read again on the next poll.
    return none;
  } finally {
    db?.close();
  }
}

export function zcodeWithDb<T>(file: string, read: (db: Database) => T, none: T): T {
  if (!existsSync(file)) return none;
  let db: Database | null = null;
  try {
    db = new Database(file, { readonly: true });
    return read(db);
  } catch {
    // ZCode may hold the database mid-write or change its schema: nothing is read this time.
    return none;
  } finally {
    db?.close();
  }
}

const CLOCK_MS = 2_000;

export function mimoSession(nonce: string, since: number, cwd: string = process.cwd(), env: Env = process.env): string | null {
  return mimoWithDb(
    env,
    (db) => {
      const row = db
        .query(
          "SELECT s.id AS id FROM session s WHERE s.parent_id IS NULL AND s.directory = ?1 AND s.time_created >= ?2 AND EXISTS (SELECT 1 FROM part p WHERE p.session_id = s.id AND instr(p.data, ?3) > 0) ORDER BY s.time_created LIMIT 1",
        )
        .get(realDir(cwd), since - CLOCK_MS, nonce);
      return typeof row === "object" && row !== null && "id" in row && typeof row.id === "string" ? row.id : null;
    },
    null,
  );
}

export function mimoIdle(session: string, env: Env = process.env): { idle: boolean; since: number | null } {
  return mimoWithDb(
    env,
    (db) => {
      const row = db.query("SELECT data FROM message WHERE session_id = ?1 AND agent_id = 'main' ORDER BY time_created DESC LIMIT 1").get(session);
      const data = typeof row === "object" && row !== null && "data" in row && typeof row.data === "string" ? row.data : null;
      if (!data) return { idle: false, since: null };
      const m: unknown = JSON.parse(data);
      if (typeof m !== "object" || m === null || !("role" in m) || m.role !== "assistant" || !("time" in m)) return { idle: false, since: null };
      const time = m.time;
      const done = typeof time === "object" && time !== null && "completed" in time && typeof time.completed === "number" ? time.completed : null;
      return done === null ? { idle: false, since: null } : { idle: true, since: done };
    },
    { idle: false, since: null },
  );
}

export const KIMI_EXPORTS = [
  "clearPane",
  "descendantsOf",
  "isListener",
  "kimiArgv",
  "kimiIdle",
  "kimiScreen",
  "kimiSession",
  "listenersUnder",
  "paneIsOurs",
  "paneText",
  "pasteBracketed",
  "processes",
  "stopStrays",
  "strayKey",
  "tmuxPastesFlag",
  "tmuxVersion",
  "typeInto",
];
