import { allSeats, loadConfig } from "../../config.ts";
import { selfCommand } from "../../hooks/self.ts";
import { loginPath } from "../../launch/shell.ts";
import type { PlaceTools, TerminalPlugin } from "../plugin.ts";
import { helpersOn } from "../registry.ts";
import { onHostedSocket } from "../shared/tmux.ts";
import { downloadTmuxHelpers, liveSockets, removeTmuxHelpers } from "./helpers.ts";
import { tmuxPlaceFrom } from "./locate.ts";
import { tmuxManifest } from "./manifest.ts";
import { tmuxMarker } from "./mark.ts";
import { tmuxSeats } from "./seats.ts";
import { showPane } from "./show.ts";
import { tmuxPane } from "./type.ts";

function sockets(): string[] {
  return liveSockets(allSeats(loadConfig()).flatMap((r) => (r.tmux && !onHostedSocket(r.tmux.socket) ? [r.tmux.socket] : [])));
}

export function tmuxTerminal(t: PlaceTools): TerminalPlugin {
  let found: Promise<string | null> | null = null;
  const located = (): Promise<string | null> => (found ??= t.tmux !== undefined ? Promise.resolve(t.tmux) : loginPath().then((PATH) => Bun.which("tmux", { PATH })));
  const tmux = async (): Promise<string> => (await located()) ?? "tmux";
  return {
    manifest: tmuxManifest,
    detect: async () => {
      const bin = await located();
      return { found: !!bin, running: !!bin && sockets().length > 0 };
    },
    helpers: {
      status: () => (helpersOn("tmux", loadConfig()) ? "on" : "off"),
      download: async () => void (await downloadTmuxHelpers(selfCommand(), { tmux: await tmux(), sockets: sockets() })),
      remove: async () => removeTmuxHelpers({ tmux: await tmux(), sockets: sockets() }),
    },
    locate: tmuxPlaceFrom,
    mark: tmuxMarker(tmux),
    seats: (cfg) => tmuxSeats(cfg).map((seat) => ({ place: "tmux", ...seat })),
    show: async (place) => (place.tmux ? showPane(place.tmux, await tmux()) : { ok: false, why: "failed" }),
    type: (place) => {
      const bin = t.tmux === undefined ? Bun.which("tmux") : t.tmux;
      return place.tmux && bin ? tmuxPane(place.tmux, bin) : null;
    },
  };
}
