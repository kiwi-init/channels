import type { TerminalManifest } from "../plugin.ts";

export const appManifest: TerminalManifest = {
  id: "app",
  name: "Terminal",
  platforms: ["darwin"],
  helpers: null,
  can: ["open"],
};
