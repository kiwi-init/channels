import type { TerminalManifest } from "../plugin.ts";

export const tmuxManifest: TerminalManifest = {
  id: "tmux",
  name: "tmux",
  platforms: ["darwin", "linux"],
  helpers: { version: 1, files: ["kiwi.tmux.conf"] },
  can: ["locate", "mark", "show", "type"],
};
