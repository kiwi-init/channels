import type { Handlers } from "../calls.ts";
import type { Host } from "../host.ts";
import { daemonCalls } from "./daemon.ts";
import { devicesCalls, storeDeviceHost } from "./devices.ts";
import { githubCalls } from "./github.ts";
import { launchCalls } from "./launch.ts";
import { linkingCalls } from "./linking.ts";
import { miscCalls } from "./misc.ts";
import { personalitiesCalls } from "./personalities.ts";
import { signInCalls } from "./signin.ts";
import { storeCalls } from "./store.ts";
import { terminalsCalls } from "./terminals.ts";
import { termsCalls } from "./terms.ts";
import { uiCalls } from "./ui.ts";

export function handlers(host: Host): Handlers {
  const devices = storeDeviceHost();
  return {
    ...storeCalls(host),
    ...signInCalls(host),
    ...githubCalls(host),
    ...linkingCalls(),
    ...devicesCalls(devices),
    ...daemonCalls(devices),
    ...miscCalls(host),
    ...personalitiesCalls(),
    ...terminalsCalls(),
    ...termsCalls(host),
    ...launchCalls(host),
    ...uiCalls(),
  };
}
