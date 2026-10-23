import type { KeysReply, KeysRequest, StoreSnapshot } from "./bridge.ts";
import type { Call, CallArgs, CallValue, Handlers, Pushes } from "./calls.ts";
import { PAGE_URL } from "./eb-page.ts";
import type { KeysFrame } from "./keys-eb.ts";

export const BOOT_GLOBAL = "__kiwiBoot";

export const RECEIVE_GLOBAL = "__kiwiReceive";

export const toPageScript = (packet: unknown): string => `window.${RECEIVE_GLOBAL}?.(${JSON.stringify(packet)});`;

type BridgeRequests = { [K in Call]: { params: CallArgs<K>; response: CallValue<K> } };
export type CallSide = { requests: BridgeRequests; messages: Pushes };
export type BunSide = { requests: BridgeRequests & { keys: { params: KeysRequest; response: KeysReply } }; messages: Pushes & { keys: KeysFrame } };

export function keysRequest(params: unknown): KeysRequest | null {
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const id = (params as { id?: unknown }).id;
  return typeof id === "number" && Number.isSafeInteger(id) ? (params as KeysRequest) : null;
}
export type PageSide = { requests: Record<never, never>; messages: Record<never, never> };

export interface Frame {
  session: string;
  doc?: string;
  packet?: unknown;
}

const SESSION = /^[A-Za-z0-9-]{16,64}$/;

export function frameOf(v: unknown): Frame | null {
  if (!v || typeof v !== "object") return null;
  const { session, doc, packet } = v as { session?: unknown; doc?: unknown; packet?: unknown };
  if (typeof session !== "string" || !SESSION.test(session)) return null;
  if (doc !== undefined && (typeof doc !== "string" || !SESSION.test(doc))) return null;
  return { session, ...(doc === undefined ? {} : { doc }), ...(packet === undefined ? {} : { packet }) };
}

export interface Boot {
  snapshot: StoreSnapshot;
  session: string;
}

export function bootOf(v: unknown): Boot | null {
  if (!v || typeof v !== "object") return null;
  const { snapshot, session } = v as { snapshot?: unknown; session?: unknown };
  if (!snapshot || typeof snapshot !== "object" || typeof session !== "string" || !SESSION.test(session)) return null;
  return { snapshot: snapshot as StoreSnapshot, session };
}

export const onOurPage = (url: string | null): boolean => url !== null && url.split("#")[0] === PAGE_URL;

export interface PacketTransport<Out = unknown> {
  send?: (packet: Out) => void | PromiseLike<void>;
  registerHandler?: (handler: (packet: unknown) => void) => void;
  unregisterHandler?: () => void;
}

export function pageOnly<Out>(t: PacketTransport<Out>, onPage: () => boolean): PacketTransport<Out> {
  return {
    send: (packet) => (onPage() ? t.send?.(packet) : undefined),
    registerHandler: (handler) => t.registerHandler?.((packet) => (onPage() ? handler(packet) : undefined)),
    unregisterHandler: () => t.unregisterHandler?.(),
  };
}

const isCall = (table: Handlers, method: unknown): method is Call => typeof method === "string" && Object.hasOwn(table, method);

function run<K extends Call>(table: Handlers, name: K, args: CallArgs<K>): Promise<CallValue<K>> {
  const fn: Handlers[K] = table[name];
  return Promise.resolve().then(() => fn(...args));
}

export function answer(table: Handlers, method: unknown, params: unknown): Promise<unknown> {
  if (!isCall(table, method)) return Promise.reject(new Error("the app has no such call"));
  if (!Array.isArray(params)) return Promise.reject(new Error(`${method} takes its arguments as a list`));
  return run(table, method, params as CallArgs<typeof method>);
}

export const preloadSource = (boot: Boot, bundle: string): string => `globalThis.${BOOT_GLOBAL} = ${JSON.stringify(boot)};\n${bundle}`;

export const PAGE_INTERNAL_RPC: ReadonlySet<string> = new Set(["startWindowMove", "stopWindowMove", "restoreWindowFocusAfterExternalDrop"]);

export interface InternalRpc {
  request: Record<string, (params: never) => unknown>;
  message: Record<string, (params: never) => unknown>;
}

export function lockInternalRpc(rpc: InternalRpc, keep: ReadonlySet<string> = PAGE_INTERNAL_RPC): string[] {
  const dropped: string[] = [];
  for (const table of [rpc.request, rpc.message])
    for (const name of Object.keys(table)) {
      if (keep.has(name)) continue;
      table[name] = () => undefined;
      dropped.push(name);
    }
  return dropped;
}
