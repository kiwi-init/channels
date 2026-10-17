import { BACKUP_MAX_BYTES, readEnvelope, type BackupEnvelope } from "../backup.ts";
import { withCors } from "./mailbox.ts";
import { HUMAN_HEADER, type HumanAuth } from "./human.ts";

export interface BackupRecord {
  envelope: BackupEnvelope;
  at: number;
}

export interface BackupStore {
  load(user: string): Promise<BackupRecord | null>;
  save(user: string, rec: BackupRecord): Promise<void>;
  drop(user: string): Promise<void>;
}

export const BACKUP_PATH = "/v1/backup";
export const BACKUP_PER_HOUR = 20;

const refuse = (status: number, tag: string, error: string) => withCors(Response.json({ error, tag }, { status }));

export function hourlyLimit(max: number, now: () => number = Date.now): (user: string) => boolean {
  const seen = new Map<string, number[]>();
  return (user) => {
    const t = now();
    const recent = (seen.get(user) ?? []).filter((at) => t - at < 3_600_000);
    if (recent.length >= max) {
      seen.set(user, recent);
      return false;
    }
    seen.set(user, [...recent, t]);
    return true;
  };
}

export async function onBackupHttp(
  req: Request,
  store: BackupStore,
  opts: { human: HumanAuth | null; allow?: (user: string) => boolean | Promise<boolean>; now?: () => number },
): Promise<Response | null> {
  if (new URL(req.url).pathname !== BACKUP_PATH) return null;
  if (!opts.human) return refuse(404, "NotFound", "this relay has no sign-in, so it keeps no backups");
  const token = req.headers.get(HUMAN_HEADER) ?? req.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "";
  const user = token ? await opts.human.verify(token).catch(() => null) : null;
  if (!user) return refuse(401, "Unauthorized", "sign in to reach your backup");
  if (opts.allow && !(await opts.allow(user))) return refuse(429, "TooMany", "too many backup requests; try again later");

  if (req.method === "GET") {
    const rec = await store.load(user);
    return rec ? withCors(Response.json({ envelope: rec.envelope, at: rec.at })) : refuse(404, "NotFound", "no backup");
  }
  if (req.method === "PUT") {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > BACKUP_MAX_BYTES) return refuse(413, "TooLarge", "a backup holds at most 256 KiB");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(400, "BadRequest", "bad json");
    }
    const envelope = readEnvelope((body as { envelope?: unknown } | null)?.envelope);
    if (!envelope) return refuse(400, "BadRequest", "not a Kiwi backup");
    await store.save(user, { envelope, at: (opts.now ?? Date.now)() });
    return withCors(new Response(null, { status: 204 }));
  }
  if (req.method === "DELETE") {
    await store.drop(user);
    return withCors(new Response(null, { status: 204 }));
  }
  return refuse(405, "MethodNotAllowed", "use GET, PUT or DELETE");
}
