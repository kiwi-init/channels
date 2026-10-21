import type { PlaceRequest, Placed, PlaceTools, TerminalPlugin } from "../plugin.ts";
import { loginArgv } from "../shared/launch.ts";
import { run, said } from "../shared/run.ts";
import { tmuxManifest } from "./manifest.ts";

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

export function tmuxTerminal(t: PlaceTools): TerminalPlugin {
  return {
    manifest: tmuxManifest,
    detect: async () => ({ found: !!t.tmux, running: !!t.tmux }),
    open: async (req) => (t.tmux ? openTmux({ ...t, tmux: t.tmux }, req) : { ok: false, why: "no-place", detail: "tmux isn't installed on this computer" }),
  };
}
