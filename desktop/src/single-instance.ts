import { dlopen, FFIType } from "bun:ffi";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export type Handoff = { kind: "link"; url: string } | { kind: "show" };

export type Instance = { kind: "first"; listening: boolean; release: () => void } | { kind: "second"; delivered: boolean };

export interface InstanceOptions {
  dir: string;
  handoff: Handoff;
  onHandoff: (h: Handoff) => void;
  waitMs?: number;
  platform?: NodeJS.Platform;
}

const LOCK_EX = 2;
const LOCK_NB = 4;
const MAX_LINE = 4096;
const MAX_URL = 2048;

export const LOCK_FILE = "app.lock";
export const SOCKET_FILE = "app.sock";

const oCloexec = (platform: NodeJS.Platform): number => (platform === "darwin" ? 0x1000000 : 0o2000000);

const flock = (platform: NodeJS.Platform) =>
  dlopen(platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } }).symbols.flock;

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function handoffFor(argv: readonly string[], scheme: string): Handoff {
  const url = argv.find((a) => a.startsWith(`${scheme}://`));
  return url && url.length <= MAX_URL ? { kind: "link", url } : { kind: "show" };
}

export function readHandoff(line: string): Handoff | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    // A line that isn't JSON came from something other than a second Channels: ignore it.
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const { kind, url } = v as { kind?: unknown; url?: unknown };
  if (kind === "show") return { kind: "show" };
  if (kind === "link" && typeof url === "string" && url.length <= MAX_URL) return { kind: "link", url };
  return null;
}

function serve(socket: string, onHandoff: (h: Handoff) => void): Promise<net.Server> {
  const server = net.createServer((conn) => {
    let buf = "";
    let answered = false;
    conn.setTimeout(2000, () => conn.destroy());
    conn.on("error", () => conn.destroy());
    conn.on("data", (chunk) => {
      if (answered) return;
      buf += chunk.toString("utf8");
      const end = buf.indexOf("\n");
      if (end < 0 && buf.length <= MAX_LINE) return;
      answered = true;
      const h = end >= 0 ? readHandoff(buf.slice(0, end)) : null;
      conn.end(h ? "ok\n" : "no\n");
      if (h) onHandoff(h);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => {
      server.off("error", reject);
      fs.chmodSync(socket, 0o600);
      resolve(server);
    });
  });
}

function deliver(socket: string, h: Handoff): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = net.connect(socket);
    let answer = "";
    conn.setTimeout(2000, () => (conn.destroy(), resolve(false)));
    conn.on("connect", () => conn.write(`${JSON.stringify(h)}\n`));
    conn.on("data", (chunk) => (answer += chunk.toString("utf8")));
    conn.on("end", () => resolve(answer === "ok\n"));
    conn.on("error", () => resolve(false));
  });
}

export async function claimInstance({ dir, handoff, onHandoff, waitMs = 5000, platform = process.platform }: InstanceOptions): Promise<Instance> {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const socket = path.join(dir, SOCKET_FILE);
  const fd = fs.openSync(path.join(dir, LOCK_FILE), fs.constants.O_CREAT | fs.constants.O_RDWR | oCloexec(platform), 0o600);
  if (flock(platform)(fd, LOCK_EX | LOCK_NB) === 0) {
    fs.rmSync(socket, { force: true });
    const server = await serve(socket, onHandoff).catch(() => null);
    let released = false;
    return {
      kind: "first",
      listening: server !== null,
      release: () => {
        if (released) return;
        released = true;
        server?.close();
        if (server) fs.rmSync(socket, { force: true });
        fs.closeSync(fd);
      },
    };
  }
  fs.closeSync(fd);
  const until = Date.now() + waitMs;
  for (;;) {
    if (await deliver(socket, handoff)) return { kind: "second", delivered: true };
    if (Date.now() >= until) return { kind: "second", delivered: false };
    await later(100);
  }
}
