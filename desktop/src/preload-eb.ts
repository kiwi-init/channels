import type {} from "electrobun/view";

import type { StoreSnapshot } from "./bridge.ts";
import { makeBridge } from "./calls.ts";
import { BOOT_GLOBAL, RECEIVE_GLOBAL } from "./eb-bridge.ts";
import { keysPort } from "./keys-page.ts";
import { pageBridge } from "./rpc-eb.ts";

const boot: unknown = Reflect.get(globalThis, BOOT_GLOBAL);
Reflect.deleteProperty(globalThis, BOOT_GLOBAL);
if (!boot || typeof boot !== "object") throw new Error("Channels' window started without the app's snapshot");

const bridge = pageBridge(
  (packet) => window.__electrobunHostBridge?.postMessage(JSON.stringify(packet)),
  (receive) => Object.defineProperty(globalThis, RECEIVE_GLOBAL, { value: receive }),
);
const { call, listen } = bridge;

const channels = keysPort(bridge);

Object.defineProperty(window, "kiwi", { value: Object.freeze(makeBridge({ snapshot: boot as StoreSnapshot, channels, call, listen })), enumerable: true });
