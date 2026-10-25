import type {} from "electrobun/view";

import { makeBridge } from "./calls.ts";
import { BOOT_GLOBAL, bootOf, RECEIVE_GLOBAL } from "./eb-bridge.ts";
import { keysPort } from "./keys-page.ts";
import { pageBridge } from "./rpc-eb.ts";

interface MessageHandler {
  postMessage(message: string): void;
}

const isHandler = (v: unknown): v is MessageHandler => typeof v === "object" && v !== null && typeof (v as { postMessage?: unknown }).postMessage === "function";

function nativeHandler(): MessageHandler | null {
  const signed: unknown = window.__electrobunHostBridge;
  if (isHandler(signed)) return signed;
  const webkit: unknown = Reflect.get(window, "webkit");
  const handlers: unknown = typeof webkit === "object" && webkit !== null ? Reflect.get(webkit, "messageHandlers") : null;
  for (const name of ["hostBridge", "bunBridge"]) {
    const handler: unknown = typeof handlers === "object" && handlers !== null ? Reflect.get(handlers, name) : null;
    if (isHandler(handler)) return handler;
  }
  return null;
}

const boot = bootOf(Reflect.get(globalThis, BOOT_GLOBAL));
Reflect.deleteProperty(globalThis, BOOT_GLOBAL);
const handler = nativeHandler();
const postMessage = handler?.postMessage;
const apply = Reflect.apply;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;

function expose(): void {
  if (!boot || !handler || !postMessage) throw new Error("Channels' window started without the app's snapshot or its bridge");
  const bridge = pageBridge(
    (json) => void apply(postMessage, handler, [json]),
    (receive) => defineProperty(window, RECEIVE_GLOBAL, { value: receive }),
    boot.session,
  );
  const { call, listen } = bridge;
  const channels = keysPort(bridge);
  defineProperty(window, "kiwi", { value: freeze(makeBridge({ snapshot: boot.snapshot, channels, call, listen })), enumerable: true });
}

if (window.self === window.top) expose();
