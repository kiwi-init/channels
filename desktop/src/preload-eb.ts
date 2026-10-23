import type {} from "electrobun/view";

import { makeBridge } from "./calls.ts";
import { BOOT_GLOBAL, bootOf, RECEIVE_GLOBAL } from "./eb-bridge.ts";
import { keysPort } from "./keys-page.ts";
import { pageBridge } from "./rpc-eb.ts";

const boot = bootOf(Reflect.get(globalThis, BOOT_GLOBAL));
Reflect.deleteProperty(globalThis, BOOT_GLOBAL);

function expose(): void {
  if (!boot) throw new Error("Channels' window started without the app's snapshot");
  const bridge = pageBridge(
    (frame) => window.__electrobunHostBridge?.postMessage(JSON.stringify(frame)),
    (receive) => Object.defineProperty(globalThis, RECEIVE_GLOBAL, { value: receive }),
    boot.session,
  );
  const { call, listen } = bridge;
  const channels = keysPort(bridge);
  Object.defineProperty(window, "kiwi", { value: Object.freeze(makeBridge({ snapshot: boot.snapshot, channels, call, listen })), enumerable: true });
}

if (window.self === window.top) expose();
