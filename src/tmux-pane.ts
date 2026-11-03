import { runNow, tmuxSocket } from "./loop/tmux.ts";

type Env = Record<string, string | undefined>;

export interface TmuxPlace {
  socket: string;
  pane: string;
}

export interface Pane {
  screen(): string | null;
  type(text: string): boolean;
  enter(): boolean;
  erase(count: number): boolean;
}

const SOCKET = /^\/[\x20-\x7e]{1,1023}$/;
const PANE = /^%\d{1,10}$/;

export function tmuxPlaceFrom(env: Env): { tmux?: TmuxPlace } {
  const socket = tmuxSocket(env);
  const pane = env.TMUX_PANE?.trim();
  return socket && SOCKET.test(socket) && pane && PANE.test(pane) ? { tmux: { socket, pane } } : {};
}

export function tmuxPane(place: TmuxPlace, bin: string): Pane {
  const tmux = (...args: string[]) => runNow([bin, "-u", "-S", place.socket, ...args]);
  const ok = (...args: string[]) => tmux(...args).status === 0;
  const buffer = `kiwi-type-${process.pid}`;
  return {
    screen: () => {
      const r = tmux("capture-pane", "-p", "-J", "-t", place.pane);
      return r.status === 0 ? r.stdout : null;
    },
    type: (text) => {
      const pasted = ok("set-buffer", "-b", buffer, "--", text) && ok("paste-buffer", "-p", "-d", "-b", buffer, "-t", place.pane);
      if (!pasted) ok("delete-buffer", "-b", buffer);
      return pasted;
    },
    enter: () => ok("send-keys", "-t", place.pane, "Enter"),
    erase: (count) => ok("send-keys", "-t", place.pane, ...Array.from({ length: count }, () => "BSpace")),
  };
}
