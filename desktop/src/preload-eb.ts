import type {} from "electrobun/view";

import type { KeysPort, KeysReply, StoreSnapshot } from "./bridge.ts";
import { makeBridge } from "./calls.ts";
import { BOOT_GLOBAL, RECEIVE_GLOBAL } from "./eb-bridge.ts";
import { pageBridge } from "./rpc-eb.ts";

const boot: unknown = Reflect.get(globalThis, BOOT_GLOBAL);
Reflect.deleteProperty(globalThis, BOOT_GLOBAL);
if (!boot || typeof boot !== "object") throw new Error("Channels' window started without the app's snapshot");

const { call, listen } = pageBridge(
  (packet) => window.__electrobunHostBridge?.postMessage(JSON.stringify(packet)),
  (receive) => Object.defineProperty(globalThis, RECEIVE_GLOBAL, { value: receive }),
);

const unreachable = (id: number): KeysReply => ({ id, ok: false, error: { kind: "unreachable", message: "this build of Channels doesn't hold your keys yet" } });

const channels: KeysPort = {
  request: () => Promise.resolve(unreachable(0)),
  onPush: () => () => {},
  onRestart: () => () => {},
};

Object.defineProperty(window, "kiwi", { value: Object.freeze(makeBridge({ snapshot: boot as StoreSnapshot, channels, call, listen })), enumerable: true });
