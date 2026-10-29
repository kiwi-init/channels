import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { pidAlive } from "./pid.ts";

interface KimiServer {
  origin: string;
  token: string;
}

export function kimiHome(env: Record<string, string | undefined> = process.env): string {
  return env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
}

function instance(file: string): { pid: number; host: string; port: number } | null {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown; host?: unknown; port?: unknown };
    return typeof v.pid === "number" && typeof v.host === "string" && typeof v.port === "number" ? { pid: v.pid, host: v.host, port: v.port } : null;
  } catch {
    // A server writes its file atomically, so this is one being removed or not Kimi's: skip it.
    return null;
  }
}

function reachable(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

export function kimiServer(pid: number | undefined, home: string = kimiHome()): KimiServer | null {
  if (!pid || !pidAlive(pid)) return null;
  const dir = join(home, "server", "instances");
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    // No Kimi server has ever run in this home.
    return null;
  }
  const mine = names.map((n) => instance(join(dir, n))).find((i) => i?.pid === pid);
  if (!mine) return null;
  let token: string;
  try {
    token = readFileSync(join(home, "server.token"), "utf8").trim();
  } catch {
    // A server without its token file can't be called.
    return null;
  }
  return token ? { origin: `http://${reachable(mine.host)}:${mine.port}`, token } : null;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // A folder that's gone compares as written.
    return path;
  }
}

export async function kimiSessionHere(pid: number | undefined, cwd: string, home: string = kimiHome()): Promise<string | null> {
  const server = kimiServer(pid, home);
  if (!server) return null;
  try {
    const res = await fetch(`${server.origin}/api/v1/sessions?busy=true`, { headers: { authorization: `Bearer ${server.token}` }, signal: AbortSignal.timeout(3_000) });
    const body = (await res.json()) as { data?: { items?: { id?: unknown; busy?: unknown; metadata?: { cwd?: unknown } }[] } };
    const at = real(cwd);
    const busy = (body.data?.items ?? []).flatMap((s) => (typeof s.id === "string" && s.busy === true && typeof s.metadata?.cwd === "string" ? [{ id: s.id, cwd: real(s.metadata.cwd) }] : []));
    const here = busy.filter((s) => at === s.cwd || at.startsWith(s.cwd.endsWith(sep) ? s.cwd : `${s.cwd}${sep}`));
    return here.length === 1 ? here[0]!.id : null;
  } catch {
    // The server didn't answer: Kimi's Stop hook names the session at the end of the turn instead.
    return null;
  }
}

export async function promptKimi(server: KimiServer, session: string, text: string, ms: number): Promise<string | null> {
  try {
    const res = await fetch(`${server.origin}/api/v1/sessions/${encodeURIComponent(session)}/prompts`, {
      method: "POST",
      headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(ms),
    });
    const body = (await res.json().catch(() => null)) as { code?: unknown; msg?: unknown } | null;
    if (res.ok && body?.code === 0) return null;
    return `Kimi's server answered ${res.status}${typeof body?.msg === "string" ? `: ${body.msg.slice(0, 160)}` : ""}`;
  } catch (err) {
    return `Kimi's server unreachable: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`;
  }
}
