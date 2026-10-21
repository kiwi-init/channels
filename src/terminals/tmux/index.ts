import { realpathSync } from "node:fs";
import { join } from "node:path";
import { allSeats, loadConfig } from "../../config.ts";
import { selfCommand } from "../../hooks/self.ts";
import type { PlaceRequest, Placed, PlaceTools, TerminalPlugin } from "../plugin.ts";
import { helpersOn } from "../registry.ts";
import { loginArgv } from "../shared/launch.ts";
import { run, said } from "../shared/run.ts";
import { tmuxSocket } from "../shared/tmux.ts";
import { downloadTmuxHelpers, removeTmuxHelpers } from "./helpers.ts";
import { tmuxPlaceFrom } from "./locate.ts";
import { tmuxManifest } from "./manifest.ts";
import { tmuxMarker } from "./mark.ts";
import { showPane } from "./show.ts";

const TMUX_SESSION = "kiwi";
const TMUX_FORMAT = "#{socket_path}\t#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_pid}";
const NO_SESSION = /error connecting to|no server running|can't find session/;

async function openTmux(t: PlaceTools & { tmux: string }, req: PlaceRequest): Promise<Placed> {
  const tmux = (...args: string[]) => run([t.tmux, "-u", ...(t.socket ? ["-S", t.socket] : []), ...args]);
  const tail = ["-c", req.folder, "-n", req.name, "-P", "-F", TMUX_FORMAT, "--", ...loginArgv(t.shell, req.argv, req.env)];
  const window = () => tmux("new-window", "-d", "-t", `=${TMUX_SESSION}:`, ...tail);
  let r = await window();
  if (r.status !== 0 && NO_SESSION.test(r.stderr)) r = await tmux("new-session", "-d", "-s", TMUX_SESSION, ...tail);
  if (r.status !== 0 && r.stderr.includes("duplicate session")) r = await window();
  if (r.status !== 0) return { ok: false, why: "failed", detail: `tmux: ${said(r)}` };
  const [socket, session, win, pane, pid] = r.stdout.trim().split("\t");
  if (!socket || !session || !win || !pane) return { ok: false, why: "failed", detail: "tmux opened a window but didn't say which" };
  return { ok: true, place: "tmux", socket, session, window: win, pane, ...(Number(pid) > 0 ? { pid: Number(pid) } : {}) };
}

function liveSockets(): string[] {
  const own = join(process.env.TMUX_TMPDIR || "/tmp", `tmux-${process.getuid?.() ?? 0}`, "default");
  const seats = allSeats(loadConfig()).flatMap((r) => (r.tmux ? [r.tmux.socket] : []));
  const real = (socket: string): string[] => {
    try {
      return [realpathSync(socket)];
    } catch {
      // No socket there means no server running to change.
      return [];
    }
  };
  return [...new Set([tmuxSocket(process.env), own, ...seats].flatMap((s) => (s ? real(s) : [])))];
}

export function tmuxTerminal(t: PlaceTools): TerminalPlugin {
  const tmux = t.tmux ?? "tmux";
  return {
    manifest: tmuxManifest,
    detect: async () => ({ found: !!t.tmux, running: !!t.tmux }),
    helpers: {
      status: () => (helpersOn("tmux", loadConfig()) ? "on" : "off"),
      download: async () => void (await downloadTmuxHelpers(selfCommand(), { tmux, sockets: liveSockets() })),
      remove: () => removeTmuxHelpers({ tmux, sockets: liveSockets() }),
    },
    locate: tmuxPlaceFrom,
    mark: tmuxMarker(tmux),
    show: async (place) => (place.tmux ? showPane(place.tmux, tmux) : { ok: false, why: "failed" }),
    open: async (req) => (t.tmux ? openTmux({ ...t, tmux: t.tmux }, req) : { ok: false, why: "no-place", detail: "tmux isn't installed on this computer" }),
  };
}
