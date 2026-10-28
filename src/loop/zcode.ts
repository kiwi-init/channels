import { Database } from "bun:sqlite";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { zcodeConfigPath } from "../hooks/install/zcode.ts";
import { descendantsOf, processes, type KimiScreen, type Proc } from "./kimi.ts";

type Env = Record<string, string | undefined>;

const CLOCK_MS = 2_000;
const READY = "Type a prompt";

export function zcodeArgv({ bin }: { bin: string }): string[] {
  return [bin];
}

export function zcodeScreen(text: string): KimiScreen {
  return text.includes(READY) ? "ready" : "starting";
}

function zcodeDb(env: Env = process.env): string {
  return join(dirname(zcodeConfigPath(env)), "db", "db.sqlite");
}

function realDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    // A folder that can't be resolved is matched as given.
    return dir;
  }
}

function withDb<T>(file: string, read: (db: Database) => T, none: T): T {
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

export function zcodeSession(nonce: string, since: number, cwd: string = process.cwd(), file: string = zcodeDb()): string | null {
  return withDb(
    file,
    (db) => {
      const row = db
        .query<{ id: string }, [string, number, string]>(
          `select s.id from session s
           where s.directory = ? and s.time_created >= ? and s.parent_id is null
             and exists (select 1 from part p join message m on m.id = p.message_id
                         where p.session_id = s.id and json_extract(m.data, '$.role') = 'user' and instr(json_extract(p.data, '$.text'), ?) > 0)
           order by s.time_created limit 1`,
        )
        .get(realDir(cwd), since - CLOCK_MS, nonce);
      return row?.id ?? null;
    },
    null,
  );
}

export function zcodeIdle(session: string, file: string = zcodeDb()): { idle: boolean; since: number | null } {
  return withDb(
    file,
    (db) => {
      const ended = db.query<{ at: number | null }, [string]>("select max(completed_at) as at from turn_usage where session_id = ?").get(session)?.at ?? null;
      const asked =
        db.query<{ n: number }, [string, number]>("select count(*) as n from message where session_id = ? and json_extract(data, '$.role') = 'user' and time_created > ?").get(session, ended ?? 0)
          ?.n ?? 0;
      return { idle: asked === 0, since: ended };
    },
    { idle: false, since: null },
  );
}

export function zcodeProcess(pid: number, procs: readonly Proc[] = processes()): number | null {
  const named = [...procs.filter((p) => p.pid === pid), ...descendantsOf(pid, procs)].filter((p) => basename(p.args.trim().split(/\s+/)[0] ?? "") === "zcode-cli");
  return named.at(-1)?.pid ?? null;
}
