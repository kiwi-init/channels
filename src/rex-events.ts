import { spawn, type ChildProcess } from "node:child_process";
import { rexBinary } from "./rex.ts";

export interface RexServer {
  server: string;
  bin: string;
}

export interface RexEventsOptions {
  servers: () => RexServer[];
  onChange: (server: string, block: string, gone: boolean) => void;
  everyMs?: number;
}

interface Running {
  child: ChildProcess;
  buffer: string;
  backoff: number;
  retry: ReturnType<typeof setTimeout> | null;
}

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

const object = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

const GONE = new Set(["child_exited", "block_closed"]);

function blockEvent(line: unknown): { block: string; gone: boolean } | null {
  const outer = object(line);
  if (outer?.type !== "session_event") return null;
  const event = object(object(outer.payload)?.event);
  const payload = object(event?.payload);
  const block = payload?.block_id;
  if (typeof block !== "string" || !block.startsWith("block:")) return null;
  const name = event?.type === "block_event" ? payload?.name : event?.type;
  return typeof name === "string" ? { block, gone: GONE.has(name) } : null;
}

export function startRexEvents(opts: RexEventsOptions): { stop(): void } {
  const everyMs = opts.everyMs ?? 5_000;
  const running = new Map<string, Running>();
  const seen = new Map<string, number>();
  const backoffs = new Map<string, number>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = (server: string, bin: string): void => {
    if (stopped || running.has(server)) return;
    const child = spawn(bin, ["-S", server, "events", "--all", "--json"], { stdio: ["ignore", "pipe", "ignore"] });
    const slot: Running = { child, buffer: "", backoff: backoffs.get(server) ?? 0, retry: null };
    running.set(server, slot);
    child.stdout?.on("data", (data: Buffer) => {
      if (running.get(server) !== slot) return;
      slot.backoff = 0;
      backoffs.delete(server);
      slot.buffer += data.toString("utf8");
      for (;;) {
        const cut = slot.buffer.indexOf("\n");
        if (cut < 0) break;
        const line = slot.buffer.slice(0, cut).trim();
        slot.buffer = slot.buffer.slice(cut + 1);
        if (!line) continue;
        let event: unknown;
        try {
          event = JSON.parse(line) as unknown;
        } catch {
          continue;
        }
        const named = blockEvent(event);
        if (!named) continue;
        const { block, gone } = named;
        const key = `${server}\u0000${block}`;
        const at = Date.now();
        if (!gone && at - (seen.get(key) ?? 0) < 100) continue;
        seen.set(key, at);
        opts.onChange(server, block, gone);
      }
    });
    child.on("error", () => {});
    child.on("close", () => {
      if (running.get(server) !== slot) return;
      running.delete(server);
      if (stopped) return;
      slot.backoff = slot.backoff ? Math.min(slot.backoff * 2, RETRY_MAX_MS) : RETRY_MIN_MS;
      backoffs.set(server, slot.backoff);
      slot.retry = setTimeout(() => {
        retries.delete(slot.retry!);
        const again = serverList().find((s) => s.server === server);
        if (again) start(server, again.bin);
      }, slot.backoff);
      retries.add(slot.retry);
    });
  };

  const reconcile = (): void => {
    if (stopped) return;
    const wanted = new Map(serverList().map((s) => [s.server, s.bin]));
    for (const [server, slot] of running) {
      if (wanted.has(server)) continue;
      running.delete(server);
      backoffs.delete(server);
      if (slot.retry) {
        clearTimeout(slot.retry);
        retries.delete(slot.retry);
      }
      slot.child.kill();
    }
    for (const [server, bin] of wanted) start(server, bin);
  };

  const serverList = (): RexServer[] => {
    try {
      return opts.servers();
    } catch {
      return [];
    }
  };

  reconcile();
  timer = setInterval(reconcile, everyMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      for (const slot of running.values()) {
        if (slot.retry) clearTimeout(slot.retry);
        slot.child.kill();
      }
      for (const retry of retries) clearTimeout(retry);
      running.clear();
      retries.clear();
      seen.clear();
      backoffs.clear();
    },
  };
}

export function rexServers(places: { server: string }[]): RexServer[] {
  const bin = rexBinary();
  if (!bin) return [];
  return [...new Set(places.map((p) => p.server))].map((server) => ({ server, bin }));
}
