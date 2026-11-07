import path from "node:path";

import { afkScene, keepAfkScene } from "../afk-scene.ts";
import type { Serves } from "../calls.ts";
import { kiwiHome } from "../daemon-client.ts";
import type { Host } from "../host.ts";

const framesKeptFromThePage = (): boolean => process.platform === "darwin";

export function afkCalls(host: Host): Serves<"afkScene" | "keepAfkScene"> {
  const at = () => ({ home: kiwiHome(), record: path.join(host.app.path("data"), "afk-scene.json") });
  return {
    afkScene: () => (framesKeptFromThePage() ? afkScene(at()) : null),
    keepAfkScene: (html: string) => (framesKeptFromThePage() ? keepAfkScene(at(), String(html)) : null),
  };
}
