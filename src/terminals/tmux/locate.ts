import type { SeatPlace } from "../plugin.ts";
import { tmuxSocket } from "../shared/tmux.ts";

type Env = Record<string, string | undefined>;

const SOCKET = /^\/[\x20-\x7e]{1,1023}$/;
const PANE = /^%\d{1,10}$/;

export function tmuxPlaceFrom(env: Env): SeatPlace {
  const socket = tmuxSocket(env);
  const pane = env.TMUX_PANE?.trim();
  return socket && SOCKET.test(socket) && pane && PANE.test(pane) ? { tmux: { socket, pane } } : {};
}
