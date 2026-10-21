import { rexBinary } from "../rex.ts";
import { loginPath, loginShell } from "../launch/shell.ts";
import { appManifest } from "./app/manifest.ts";
import type { PlaceTools, TerminalId, TerminalManifest, TerminalPlugin } from "./plugin.ts";
import { rexManifest } from "./rex/manifest.ts";
import { tmuxManifest } from "./tmux/manifest.ts";

export const MANIFESTS: readonly TerminalManifest[] = [rexManifest, tmuxManifest, appManifest];

const LOAD: Record<TerminalId, () => Promise<(t: PlaceTools) => TerminalPlugin>> = {
  rex: async () => (await import("./rex/index.ts")).rexTerminal,
  tmux: async () => (await import("./tmux/index.ts")).tmuxTerminal,
  app: async () => (await import("./app/index.ts")).appTerminal,
};

export async function placeTools(): Promise<PlaceTools> {
  return {
    platform: process.platform,
    shell: loginShell(),
    rex: rexBinary(),
    tmux: Bun.which("tmux", { PATH: await loginPath() }),
    osascript: process.platform === "darwin" ? (Bun.which("osascript") ?? "/usr/bin/osascript") : null,
  };
}

export async function terminalPlugins(tools: PlaceTools): Promise<TerminalPlugin[]> {
  return Promise.all(MANIFESTS.filter((m) => m.platforms.includes(tools.platform)).map(async (m) => (await LOAD[m.id]())(tools)));
}
