import type { KeysPush, KeysReply } from "./bridge.ts";
import type { HostToKeys, KeysToHost } from "./keys-server.ts";

export type ToWorker = { to: "host"; m: HostToKeys; port?: number } | { to: "port"; port: number; data: unknown } | { to: "close"; port: number };

export type FromWorker = { from: "host"; m: KeysToHost } | { from: "port"; port: number; data: KeysReply | KeysPush };

interface WorkerScope {
  post(m: FromWorker): void;
  listen(fn: (m: ToWorker) => void): void;
}

type PortEvent = { data: unknown };

interface PagePort {
  on(event: "message" | "close", fn: (e: PortEvent) => void): void;
  postMessage(p: KeysReply | KeysPush): void;
  start(): void;
}

type HostEvent = { data: HostToKeys; ports: PagePort[] };

export function installKeysShim(scope: WorkerScope, target: object = process): void {
  const hostListeners: ((e: HostEvent) => void)[] = [];
  const early: HostEvent[] = [];
  const ports = new Map<number, { deliver(data: unknown): void; closed(): void }>();
  const pagePort = (id: number): PagePort => {
    const onMessage: ((e: PortEvent) => void)[] = [];
    const onClose: ((e: PortEvent) => void)[] = [];
    const waiting: unknown[] = [];
    ports.set(id, {
      deliver: (data) => {
        if (onMessage.length === 0) waiting.push(data);
        for (const fn of onMessage) fn({ data });
      },
      closed: () => {
        for (const fn of onClose) fn({ data: null });
      },
    });
    return {
      on: (event, fn) => {
        if (event === "close") return void onClose.push(fn);
        onMessage.push(fn);
        for (const data of waiting.splice(0)) fn({ data });
      },
      postMessage: (p) => scope.post({ from: "port", port: id, data: p }),
      start: () => {},
    };
  };
  scope.listen((msg) => {
    if (msg.to === "host") {
      const event: HostEvent = { data: msg.m, ports: msg.m.type === "port" && msg.port !== undefined ? [pagePort(msg.port)] : [] };
      if (hostListeners.length === 0) early.push(event);
      for (const fn of hostListeners) fn(event);
      return;
    }
    const port = ports.get(msg.port);
    if (msg.to === "port") return port?.deliver(msg.data);
    port?.closed();
    ports.delete(msg.port);
  });
  Object.defineProperty(target, "parentPort", {
    configurable: true,
    value: {
      on: (event: "message", fn: (e: HostEvent) => void) => {
        if (event !== "message") return;
        hostListeners.push(fn);
        for (const e of early.splice(0)) fn(e);
      },
      postMessage: (m: KeysToHost) => scope.post({ from: "host", m }),
    },
  });
}
