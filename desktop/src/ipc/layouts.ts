import type { Serves } from "../calls.ts";
import { kiwiHome } from "../daemon-client.ts";
import type { Host } from "../host.ts";
import { watchFolder } from "../json-folder.ts";
import { layoutsDir, readLayouts } from "../layout-folder.ts";
import { logMainError } from "../main-log.ts";

export function layoutsCalls(host: Host, home: () => string = kiwiHome): Serves<"layouts"> {
  const dir = () => layoutsDir(home());
  let stop: (() => void) | null = null;
  const watch = () => {
    if (stop) return;
    try {
      stop = watchFolder(
        dir(),
        () => host.push("layouts", readLayouts(dir())),
        () => (stop = null),
      );
    } catch (err) {
      // Without a watch the layouts still load on each call; only live changes wait for the next one.
      logMainError(new Error(`couldn't watch ${dir()}`, { cause: err }));
    }
  };
  return {
    layouts: () => {
      watch();
      return readLayouts(dir());
    },
  };
}
