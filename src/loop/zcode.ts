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

export function zcodeIdle(since: number, cwd: string = process.cwd(), file: string = zcodeDb()): { idle: boolean; since: number | null } {
  const from = since - CLOCK_MS;
  return withDb(
    file,
    (db) => {
      const row = db
        .query<{ busy: number; ended: number | null }, [string, number, number]>(
          `with here as (
             select s.id, (select max(t.completed_at) from turn_usage t where t.session_id = s.id) as ended
             from session s
             where s.directory = ? and s.parent_id is null and (s.time_created >= ? or s.time_updated >= ?)
           )
           select
             (select count(*) from here h
              where exists (select 1 from message m
                            where m.session_id = h.id and json_extract(m.data, '$.role') = 'user' and m.time_created > coalesce(h.ended, 0))) as busy,
             (select max(ended) from here) as ended`,
        )
        .get(realDir(cwd), from, from);
      return row ? { idle: row.busy === 0, since: row.ended } : { idle: false, since: null };
    },
    { idle: false, since: null },
  );
}

export function zcodeProcess(pid: number, procs: readonly Proc[] = processes()): number | null {
  const named = [...procs.filter((p) => p.pid === pid), ...descendantsOf(pid, procs)].filter((p) => basename(p.args.trim().split(/\s+/)[0] ?? "") === "zcode-cli");
  return named.at(-1)?.pid ?? null;
}
