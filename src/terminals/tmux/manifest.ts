import type { TerminalManifest } from "../plugin.ts";

export const tmuxManifest: TerminalManifest = {
  id: "tmux",
  name: "tmux",
  platforms: ["darwin", "linux"],
  helpers: null,
  can: ["open"],
};
