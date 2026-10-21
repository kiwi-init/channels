import { loadConfig } from "../../config.ts";
import type { PlaceRequest, Placed, PlaceTools, TerminalPlugin } from "../plugin.ts";
import { helpersOn } from "../registry.ts";
import { object, objectsIn, parseJson } from "../shared/json.ts";
import { loginArgv } from "../shared/launch.ts";
import { run, said } from "../shared/run.ts";
import { REX_TERMINAL, rexActivity, rexApiArgv, rexServer, rexStatus } from "./api.ts";
import { downloadHelpers, removeHelpers } from "./helpers.ts";
import { placeFrom, REX_BLOCK, REX_SESSION } from "./locate.ts";
import { rexManifest } from "./manifest.ts";
import { markSeat } from "./mark.ts";
import { localRexSeats, showInRex } from "./show.ts";
import { rexPane } from "./type.ts";
import { rexServers, startRexEvents } from "./watch.ts";

async function rex(
  t: PlaceTools & { rex: string },
  server: string | null,
  method: string,
  args: Record<string, unknown>,
  session?: string,
): Promise<{ ok: true; value: unknown } | { ok: false; detail: string }> {
  const r = await run([t.rex, ...rexApiArgv(server, method, args, session)]);
  return r.status === 0 ? { ok: true, value: parseJson(r.stdout) } : { ok: false, detail: `Rex ${method}: ${said(r)}` };
}

const REX_PLATFORM: Partial<Record<NodeJS.Platform, string>> = { darwin: "macos", linux: "linux", win32: "windows" };

async function rexSession(t: PlaceTools & { rex: string }, server: string): Promise<string | null> {
  const clients = await rex(t, server, "client.list", { kinds: ["app"] });
  const here = REX_PLATFORM[t.platform];
  const apps = (clients.ok ? objectsIn(clients.value, "clients") : [])
    .filter((c) => object(c.info)?.kind === "app" && c.connection_state !== "lost")
    .map((c) => ({
      here: object(c.info)?.platform === here,
      at: typeof c.connected_at === "string" ? Date.parse(c.connected_at) || 0 : 0,
      sessions: Array.isArray(c.session_ids) ? c.session_ids : [],
    }))
    .sort((a, b) => Number(b.here) - Number(a.here) || b.at - a.at);
  const attached = apps.flatMap((app) => app.sessions).find((id): id is string => typeof id === "string" && REX_SESSION.test(id));
  if (attached) return attached;
  const sessions = await rex(t, server, "session.list", {});
  const last = (sessions.ok ? objectsIn(sessions.value, "sessions") : []).map((s) => s.session_id).findLast((id): id is string => typeof id === "string" && REX_SESSION.test(id));
  if (last) return last;
  const made = await rex(t, server, "session.create", { label: "kiwi" });
  const id = made.ok ? object(made.value)?.session_id : null;
  return typeof id === "string" && REX_SESSION.test(id) ? id : null;
}

async function openRex(t: PlaceTools & { rex: string }, server: string, req: PlaceRequest): Promise<Placed> {
  const session = await rexSession(t, server);
  if (!session) return { ok: false, why: "failed", detail: "Rex has no session to open a window in" };
  const command = loginArgv(t.shell, req.argv, req.env);
  const block = { flavor: `${REX_TERMINAL}.shell`, label: req.name, options: { shell: "none", login: false, command, cwd: req.folder } };
  const made = await rex(t, server, "session.new_window", { session_id: session, focus: false, window_label: req.name, layout: { block } });
  if (!made.ok) return { ok: false, why: "failed", detail: made.detail };
  const window = object(made.value)?.window_id;
  const id = (object(made.value)?.block_ids as unknown[] | undefined)?.[0];
  if (typeof window !== "string" || typeof id !== "string" || !REX_BLOCK.test(id)) return { ok: false, why: "failed", detail: "Rex opened a window but didn't say which" };
  const proc = await rex(t, server, `${REX_TERMINAL}.process`, { block_id: id, args: {} }, session);
  const pid = Number(object(object(proc.ok ? proc.value : null)?.child)?.pid);
  return { ok: true, place: "rex", rex: { server, session, block: id }, window, ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}) };
}

export function rexTerminal(t: PlaceTools): TerminalPlugin {
  let server: Promise<string | null> | null = null;
  const endpoint = (): Promise<string | null> => (server ??= t.rex ? rexServer(t.rex) : Promise.resolve(null));
  return {
    manifest: rexManifest,
    detect: async (opts) => {
      const version = opts?.version ? rexStatus().version : undefined;
      return { found: !!t.rex, running: !!(await endpoint()), ...(version ? { version } : {}) };
    },
    helpers: { status: () => (helpersOn("rex", loadConfig()) ? "on" : "off"), download: downloadHelpers, remove: removeHelpers },
    locate: placeFrom,
    mark: markSeat,
    seats: (cfg) => localRexSeats(cfg).map((seat) => ({ place: "rex", ...seat })),
    show: async (place) => (place.rex ? showInRex(place.rex, t.rex) : { ok: false, why: "failed" }),
    watch: (places, changed) =>
      startRexEvents({
        servers: () => rexServers(places().flatMap((p) => (p.rex ? [p.rex] : []))),
        onChange: (server, block, gone) => changed((p) => p.rex?.server === server && p.rex.block === block, gone),
      }),
    activity: async (place) => (place.rex ? rexActivity(place.rex, t.rex) : null),
    type: (place) => (place.rex && t.rex ? rexPane(place.rex, t.rex) : null),
    open: async (req) => {
      const at = await endpoint();
      if (!at || !t.rex) return { ok: false, why: "no-place", detail: "Rex isn't running on this computer" };
      return openRex({ ...t, rex: t.rex }, at, req);
    },
  };
}
