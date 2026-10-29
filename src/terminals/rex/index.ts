import { loadConfig } from "../../config.ts";
import type { PlaceTools, TerminalPlugin } from "../plugin.ts";
import { helpersOn } from "../registry.ts";
import { rexActivity, rexServer, rexStatus } from "./api.ts";
import { downloadHelpers, removeHelpers } from "./helpers.ts";
import { placeFrom } from "./locate.ts";
import { rexManifest } from "./manifest.ts";
import { markSeat } from "./mark.ts";
import { localRexSeats, showInRex } from "./show.ts";
import { rexPane } from "./type.ts";
import { rexServers, startRexEvents } from "./watch.ts";

export function rexTerminal(t: PlaceTools): TerminalPlugin {
  let server: Promise<string | null> | null = null;
  const endpoint = (): Promise<string | null> => (server ??= t.rex ? rexServer(t.rex) : Promise.resolve(null));
  return {
    manifest: rexManifest,
    detect: async (opts) => {
      const version = opts?.version ? rexStatus().version : undefined;
      return { found: !!t.rex, running: !!(await endpoint()), ...(version ? { version } : {}) };
    },
    helpers: { status: () => (helpersOn("rex", loadConfig()) ? "on" : "off"), download: downloadHelpers, remove: removeHelpers },
    locate: placeFrom,
    mark: markSeat,
    seats: (cfg) => localRexSeats(cfg).map((seat) => ({ place: "rex", ...seat })),
    show: async (place) => (place.rex ? showInRex(place.rex, t.rex) : { ok: false, why: "failed" }),
    watch: (places, changed) =>
      startRexEvents({
        servers: () => rexServers(places().flatMap((p) => (p.rex ? [p.rex] : []))),
        onChange: (server, block, gone) => changed((p) => p.rex?.server === server && p.rex.block === block, gone),
      }),
    activity: async (place) => (place.rex ? rexActivity(place.rex, t.rex) : null),
    type: (place) => (place.rex && t.rex ? rexPane(place.rex, t.rex) : null),
  };
}
