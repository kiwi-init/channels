import { Database } from "bun:sqlite";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

type Env = Record<string, string | undefined>;

export interface MimoStart {
  bin: string;
  model?: string;
  prompt: string;
}

const CLOCK_MS = 2_000;

function mimoRoot(kind: "data" | "state", env: Env): string {
  if (env.MIMOCODE_HOME && isAbsolute(env.MIMOCODE_HOME)) return join(env.MIMOCODE_HOME, kind);
  const xdg = kind === "data" ? env.XDG_DATA_HOME : env.XDG_STATE_HOME;
  return join(xdg || join(homedir(), ".local", kind === "data" ? "share" : "state"), "mimocode");
}

function mimoChosenModel(env: Env): string | undefined {
  try {
    const r: unknown = JSON.parse(readFileSync(join(mimoRoot("state", env), "model.json"), "utf8"));
    const recent = typeof r === "object" && r !== null && "recent" in r && Array.isArray(r.recent) ? r.recent : [];
    const first: unknown = recent[0];
    if (typeof first !== "object" || first === null || !("providerID" in first) || !("modelID" in first)) return undefined;
    return typeof first.providerID === "string" && typeof first.modelID === "string" ? `${first.providerID}/${first.modelID}` : undefined;
  } catch {
    // No model chosen in MiMoCode yet: it starts with its own default.
    return undefined;
  }
}

export function mimoArgv({ bin, model, prompt }: MimoStart, env: Env = process.env): string[] {
  const chosen = model ?? mimoChosenModel(env);
  return [bin, ...(chosen ? ["-m", chosen] : []), "--prompt", prompt];
}

function withDb<A>(env: Env, read: (db: Database) => A, none: A): A {
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

function realDir(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    // A folder that can't be resolved is matched as given.
    return dir;
  }
}

export function mimoSession(nonce: string, since: number, cwd: string = process.cwd(), env: Env = process.env): string | null {
  return withDb(
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
  return withDb(
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
