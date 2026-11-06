import type { Serves } from "../calls.ts";
import { kiwiHome } from "../daemon-client.ts";
import type { Host } from "../host.ts";
import { readKeys, watchKeys } from "../keys-file.ts";
import { logMainError } from "../main-log.ts";

export function keysCalls(host: Host, home: () => string = kiwiHome): Serves<"keyBindings"> {
  let stop: (() => void) | null = null;
  const watch = () => {
    if (stop) return;
    try {
      stop = watchKeys(
        home(),
        () => host.push("keyBindings", readKeys(home())),
        () => (stop = null),
      );
    } catch (err) {
      // Without a watch keys.json still loads on each call; only live edits wait for the next one.
      logMainError(new Error(`couldn't watch ${home()}`, { cause: err }));
    }
  };
  return {
    keyBindings: () => {
      watch();
      return readKeys(home());
    },
  };
}
