import type { TerminalManifest } from "../plugin.ts";

export const rexManifest: TerminalManifest = {
  id: "rex",
  name: "Rex",
  platforms: ["darwin", "linux", "win32"],
  helpers: { version: 1, files: ["kiwi.lua", "kiwi-find.lua"] },
  can: ["open", "locate", "mark", "show", "watch", "type"],
};
