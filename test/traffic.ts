import type { ServerWebSocket } from "bun";
import { WS_PROTOCOL } from "@kiwi/core/protocol.ts";

export interface Traffic {
  http: number;
  routes: Record<string, number>;
  statuses: Record<string, number>;
  routeBytes: Record<string, number>;
  sockets: number;
  framesUp: Record<string, number>;
  framesDown: Record<string, number>;
  bytesUp: number;
  bytesDown: number;
}

const empty = (): Traffic => ({ http: 0, routes: {}, statuses: {}, routeBytes: {}, sockets: 0, framesUp: {}, framesDown: {}, bytesUp: 0, bytesDown: 0 });

const bump = (into: Record<string, number>, key: string) => void (into[key] = (into[key] ?? 0) + 1);

const routeOf = (method: string, path: string) =>
  `${method} ${
    path
      .replace(/^\/v1\/rooms\/[0-9a-f]{32}/, "")
      .replace(/\/[0-9a-f-]{36}(?=\/|$)/g, "/:id")
      .replace(/\/[A-Za-z0-9_-]{40,}(?=\/|$)/g, "/:pk") || "/"
  }`;

const frameType = (data: string | ArrayBuffer | Uint8Array): string => {
  if (typeof data !== "string") return "binary";
  try {
    const t = (JSON.parse(data) as { t?: unknown }).t;
    return typeof t === "string" ? t : "unknown";
  } catch {
    return "unknown";
  }
};

const sizeOf = (data: string | ArrayBuffer | Uint8Array) => (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength);

interface Pipe {
  upstream: WebSocket;
  queued: (string | ArrayBuffer | Uint8Array)[];
}

export function trafficProxy(target: string): { url: string; stats: Traffic; reset: () => Traffic; stop: () => void; hang: (on: boolean) => void } {
  let stats = empty();
  let hanging = false;
  const pipes = new WeakMap<ServerWebSocket<{ path: string; protocols: string[] }>, Pipe>();
  const server = Bun.serve<{ path: string; protocols: string[] }>({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (hanging && req.headers.get("upgrade") !== "websocket") return new Promise<Response>(() => {});
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await req.arrayBuffer());
      if (req.headers.get("upgrade") === "websocket") {
        stats.sockets++;
        const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        const headers = protocols.includes(WS_PROTOCOL) ? { "sec-websocket-protocol": WS_PROTOCOL } : undefined;
        if (srv.upgrade(req, { data: { path: url.pathname + url.search, protocols }, headers })) return undefined;
      }
      stats.http++;
      const route = routeOf(req.method, url.pathname);
      bump(stats.routes, route);
      stats.bytesUp += body?.byteLength ?? 0;
      const res = await fetch(target + url.pathname + url.search, { method: req.method, headers: req.headers, body });
      const out = new Uint8Array(await res.arrayBuffer());
      stats.bytesDown += out.byteLength;
      bump(stats.statuses, `${route} ${res.status}`);
      stats.routeBytes[route] = (stats.routeBytes[route] ?? 0) + out.byteLength;
      const headers = new Headers(res.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(res.status === 204 || res.status === 304 ? null : out, { status: res.status, headers });
    },
    websocket: {
      open(ws) {
        const upstream = new WebSocket(target.replace(/^http/, "ws") + ws.data.path, ws.data.protocols);
        const pipe: Pipe = { upstream, queued: [] };
        pipes.set(ws, pipe);
        upstream.binaryType = "arraybuffer";
        upstream.onopen = () => {
          for (const m of pipe.queued) upstream.send(m);
          pipe.queued = [];
        };
        upstream.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
          bump(stats.framesDown, frameType(ev.data));
          stats.bytesDown += sizeOf(ev.data);
          ws.send(ev.data);
        };
        upstream.onclose = (ev) => {
          try {
            ws.close(ev.code === 1005 || ev.code === 1006 ? 1000 : ev.code, ev.reason);
          } catch {
            // The client already hung up: nothing to pass the close on to.
          }
        };
      },
      message(ws, data) {
        const pipe = pipes.get(ws);
        if (!pipe) return;
        bump(stats.framesUp, frameType(data));
        stats.bytesUp += sizeOf(data);
        if (pipe.upstream.readyState === WebSocket.OPEN) pipe.upstream.send(data);
        else pipe.queued.push(data);
      },
      close(ws, code, reason) {
        const pipe = pipes.get(ws);
        if (!pipe) return;
        try {
          pipe.upstream.close(code === 1005 || code === 1006 ? 1000 : code, reason);
        } catch {
          // The upstream is already closed: nothing to pass the close on to.
        }
      },
    },
  });
  return {
    url: server.url.origin,
    get stats() {
      return stats;
    },
    reset: () => {
      const was = stats;
      stats = empty();
      return was;
    },
    stop: () => server.stop(true),
    hang: (on: boolean) => void (hanging = on),
  };
}

export const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
