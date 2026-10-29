import type { Pane, TmuxPlace } from "../plugin.ts";
import { runNow } from "../shared/run.ts";

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
