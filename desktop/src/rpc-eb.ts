import { createRPC, type RPCTransport } from "electrobun/rpc";

import type { KeysReply, KeysRequest } from "./bridge.ts";
import type { Call, CallArgs, CallValue, Handlers, Push, Pushes } from "./calls.ts";
import { answer, keysCall, pageOnly, type BunSide, type PageSide } from "./eb-bridge.ts";
import type { KeysFrame } from "./keys-eb.ts";

export interface BunBridge {
  setTransport(t: RPCTransport): void;
  push<P extends Push>(name: P, value: Pushes[P]): void;
  pushKeys(frame: KeysFrame): void;
}

export type KeysHandler = (session: string, req: KeysRequest) => Promise<KeysReply>;

function keysAnswer(keys: KeysHandler, params: unknown): Promise<KeysReply> {
  const call = keysCall(params);
  return call ? keys(call.session, call.req) : Promise.reject(new Error("keys takes { session, req } with a session id and a request with an id"));
}

export function bunBridge(table: Handlers, onPage: () => boolean, toPage: (packet: unknown) => void, keys: KeysHandler): BunBridge {
  const rpc = createRPC<BunSide, PageSide>({
    maxRequestTime: Infinity,
    requestHandler: (method, params) => (method === "keys" ? keysAnswer(keys, params) : answer(table, method, params)),
  });
  const send: (name: Push, value: Pushes[Push]) => void = rpc.send;
  const sendKeys: (name: "keys", value: KeysFrame) => void = rpc.send;
  return {
    setTransport: (t) => rpc.setTransport(pageOnly({ registerHandler: t.registerHandler, unregisterHandler: t.unregisterHandler, send: toPage }, onPage)),
    push: (name, value) => send(name, value),
    pushKeys: (frame) => sendKeys("keys", frame),
  };
}

export interface PageBridge {
  call<K extends Call>(name: K, ...args: CallArgs<K>): Promise<CallValue<K>>;
  listen<P extends Push>(name: P, cb: (value: Pushes[P]) => void): () => void;
  keys(session: string, req: KeysRequest): Promise<KeysReply>;
  onKeys(cb: (frame: KeysFrame) => void): () => void;
}

export function pageBridge(toHost: (packet: unknown) => void, onHost: (receive: (packet: unknown) => void) => void): PageBridge {
  const rpc = createRPC<PageSide, BunSide>({ maxRequestTime: Infinity, transport: { send: toHost, registerHandler: onHost } });
  function call<K extends Call>(name: K, ...args: CallArgs<K>): Promise<CallValue<K>> {
    return rpc.request(name, args as never) as Promise<CallValue<K>>;
  }
  function listen<P extends Push>(name: P, cb: (value: Pushes[P]) => void): () => void {
    rpc.addMessageListener(name, cb);
    return () => rpc.removeMessageListener(name, cb);
  }
  const keys = (session: string, req: KeysRequest): Promise<KeysReply> => rpc.request("keys", { session, req });
  function onKeys(cb: (frame: KeysFrame) => void): () => void {
    rpc.addMessageListener("keys", cb);
    return () => rpc.removeMessageListener("keys", cb);
  }
  return { call, listen, keys, onKeys };
}
