import { createRPC, type RPCTransport } from "electrobun/rpc";

import type { KeysReply, KeysRequest } from "./bridge.ts";
import type { Call, CallArgs, CallValue, Handlers, Push, Pushes } from "./calls.ts";
import { answer, frameOf, keysRequest, pageOnly, type BunSide, type CallSide, type Frame, type PacketTransport, type PageSide } from "./eb-bridge.ts";
import type { KeysFrame } from "./keys-eb.ts";

export interface BunBridge {
  setTransport(t: RPCTransport): void;
  push<P extends Push>(name: P, value: Pushes[P]): void;
  pushKeys(frame: KeysFrame): void;
  nextSession(): string;
}

export type KeysHandler = (session: string, req: KeysRequest) => Promise<KeysReply>;

interface Session {
  id: string;
  deliver(packet: unknown): void;
  send(name: Push, value: Pushes[Push]): void;
  sendKeys(name: "keys", value: KeysFrame): void;
}

function keysAnswer(keys: KeysHandler, session: string, params: unknown): Promise<KeysReply> {
  const req = keysRequest(params);
  return req ? keys(session, req) : Promise.reject(new Error("keys takes a request with an id"));
}

export function bunBridge(
  table: Handlers,
  onPage: () => boolean,
  toPage: (frame: Frame) => void,
  opened: (session: string) => void = () => {},
  keys: KeysHandler = () => Promise.reject(new Error("this window holds no keys")),
  mint: () => string = () => crypto.randomUUID(),
): BunBridge {
  let out: PacketTransport<Frame> = {};
  let current: Session | null = null;
  let expected = mint();
  const open = (id: string): Session => {
    let deliver: (packet: unknown) => void = () => {};
    const rpc = createRPC<BunSide, PageSide>({
      maxRequestTime: Infinity,
      requestHandler: (method, params) => (method === "keys" ? keysAnswer(keys, id, params) : answer(table, method, params)),
      transport: {
        send: (packet: unknown) => (current?.id === id ? out.send?.({ session: id, packet }) : undefined),
        registerHandler: (h: (packet: unknown) => void) => (deliver = h),
      },
    });
    const send: (name: Push, value: Pushes[Push]) => void = rpc.send;
    const sendKeys: (name: "keys", value: KeysFrame) => void = rpc.send;
    const session: Session = { id, deliver: (packet) => deliver(packet), send, sendKeys };
    current = session;
    expected = mint();
    opened(id);
    return session;
  };
  const receive = (raw: unknown): void => {
    const frame = frameOf(raw);
    if (!frame) return;
    const session = frame.session === current?.id ? current : frame.session === expected ? open(frame.session) : null;
    if (session && frame.packet !== undefined) session.deliver(frame.packet);
  };
  return {
    setTransport: (t) => {
      out = pageOnly<Frame>({ send: toPage, registerHandler: t.registerHandler, unregisterHandler: t.unregisterHandler }, onPage);
      out.registerHandler?.(receive);
    },
    push: (name, value) => current?.send(name, value),
    pushKeys: (frame) => {
      if (current?.id === frame.session) current.sendKeys("keys", frame);
    },
    nextSession: () => expected,
  };
}

export interface PageBridge {
  readonly session: string;
  call<K extends Call>(name: K, ...args: CallArgs<K>): Promise<CallValue<K>>;
  listen<P extends Push>(name: P, cb: (value: Pushes[P]) => void): () => void;
  keys(req: KeysRequest): Promise<KeysReply>;
  onKeys(cb: (frame: KeysFrame) => void): () => void;
}

export function pageBridge(toHost: (frame: Frame) => void, onHost: (receive: (frame: unknown) => void) => void, session: string): PageBridge {
  const rpc = createRPC<PageSide, BunSide>({
    maxRequestTime: Infinity,
    transport: {
      send: (packet: unknown) => toHost({ session, packet }),
      registerHandler: (h: (packet: unknown) => void) =>
        onHost((raw) => {
          const frame = frameOf(raw);
          if (frame?.session === session && frame.packet !== undefined) h(frame.packet);
        }),
    },
  });
  toHost({ session });
  const calls = rpc as unknown as ReturnType<typeof createRPC<PageSide, CallSide>>;
  function call<K extends Call>(name: K, ...args: CallArgs<K>): Promise<CallValue<K>> {
    return calls.request(name, args) as Promise<CallValue<K>>;
  }
  function listen<P extends Push>(name: P, cb: (value: Pushes[P]) => void): () => void {
    rpc.addMessageListener(name, cb);
    return () => rpc.removeMessageListener(name, cb);
  }
  const keys = (req: KeysRequest): Promise<KeysReply> => rpc.request("keys", req);
  function onKeys(cb: (frame: KeysFrame) => void): () => void {
    rpc.addMessageListener("keys", cb);
    return () => rpc.removeMessageListener("keys", cb);
  }
  return { session, call, listen, keys, onKeys };
}
