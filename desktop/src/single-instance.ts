import { dlopen, FFIType } from "bun:ffi";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export type Handoff = ({ kind: "link"; url: string } | { kind: "show" }) & { token?: string };

export type Instance = { kind: "first"; listening: boolean; release: () => void } | { kind: "second"; delivered: boolean };

export interface InstanceOptions {
  dir: string;
  handoff: Handoff;
  scheme: string;
  onHandoff: (h: Handoff) => void;
  waitMs?: number;
  platform?: NodeJS.Platform;
}

const LOCK_EX = 2;
const LOCK_NB = 4;
const MAX_LINE = 4096;
const MAX_URL = 2048;
const TOKEN = /^[\x21-\x7e]{1,512}$/;
const TOKEN_VARS = ["XDG_ACTIVATION_TOKEN", "DESKTOP_STARTUP_ID"];

export const LOCK_FILE = "app.lock";
export const SOCKET_FILE = "app.sock";

const oCloexec = (platform: NodeJS.Platform): number => (platform === "darwin" ? 0x1000000 : 0o2000000);

const flock = (platform: NodeJS.Platform) =>
  dlopen(platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } }).symbols.flock;

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function launchArgs(platform: NodeJS.Platform = process.platform, read: () => string = () => fs.readFileSync("/proc/self/cmdline", "utf8")): string[] {
  if (platform !== "linux") return process.argv;
  try {
    return read().split("\0").filter(Boolean);
  } catch {
    // No /proc to read: the runtime's own argv is all there is.
    return process.argv;
  }
}

export function launchToken(platform: NodeJS.Platform = process.platform, read: () => string = () => fs.readFileSync("/proc/self/environ", "utf8")): string | undefined {
  if (platform !== "linux") return undefined;
  let env: string[];
  try {
    env = read().split("\0");
  } catch {
    // No /proc to read: the runtime's own environment still has what GTK hasn't taken.
    env = Object.entries(process.env).map(([k, v]) => `${k}=${v ?? ""}`);
  }
  for (const name of TOKEN_VARS) {
    const value = env.find((e) => e.startsWith(`${name}=`))?.slice(name.length + 1);
    if (value && TOKEN.test(value)) return value;
  }
  return undefined;
}

export function handoffFor(argv: readonly string[], scheme: string, token?: string): Handoff {
  const url = argv.find((a) => a.startsWith(`${scheme}://`));
  const h: Handoff = url && url.length <= MAX_URL ? { kind: "link", url } : { kind: "show" };
  return token && TOKEN.test(token) ? { ...h, token } : h;
}

export function readHandoff(line: string, scheme: string): Handoff | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    // A line that isn't JSON came from something other than a second Channels: ignore it.
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const { kind, url, token } = v as { kind?: unknown; url?: unknown; token?: unknown };
  if (token !== undefined && (typeof token !== "string" || !TOKEN.test(token))) return null;
  const extra = token === undefined ? {} : { token };
  if (kind === "show") return { kind: "show", ...extra };
  if (kind === "link" && typeof url === "string" && url.length <= MAX_URL && url.startsWith(`${scheme}://`)) return { kind: "link", url, ...extra };
  return null;
}

const instancePipe = (dir: string): string => `\\\\.\\pipe\\channels-${createHash("sha256").update(path.win32.resolve(dir).toLowerCase(), "utf8").digest("hex").slice(0, 32)}`;

function serve(socket: string, scheme: string, onHandoff: (h: Handoff) => void, platform: NodeJS.Platform = process.platform): Promise<net.Server> {
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
      const h = end >= 0 ? readHandoff(buf.slice(0, end), scheme) : null;
      conn.end(h ? "ok\n" : "no\n");
      if (h) onHandoff(h);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, () => {
      server.off("error", reject);
      if (platform !== "win32") fs.chmodSync(socket, 0o600);
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

export async function claimInstance({ dir, handoff, scheme, onHandoff, waitMs = 5000, platform = process.platform }: InstanceOptions): Promise<Instance> {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (platform === "win32") return claimPipe(instancePipe(dir), handoff, scheme, onHandoff, waitMs);
  fs.chmodSync(dir, 0o700);
  const socket = path.join(dir, SOCKET_FILE);
  const fd = fs.openSync(path.join(dir, LOCK_FILE), fs.constants.O_CREAT | fs.constants.O_RDWR | oCloexec(platform), 0o600);
  if (flock(platform)(fd, LOCK_EX | LOCK_NB) === 0) {
    fs.rmSync(socket, { force: true });
    const server = await serve(socket, scheme, onHandoff).catch(() => null);
    if (handoff.kind === "link") onHandoff(handoff);
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
  return handOver(socket, handoff, waitMs);
}

async function handOver(socket: string, handoff: Handoff, waitMs: number): Promise<Instance> {
  const until = Date.now() + waitMs;
  for (;;) {
    if (await deliver(socket, handoff)) return { kind: "second", delivered: true };
    if (Date.now() >= until) return { kind: "second", delivered: false };
    await later(100);
  }
}

async function claimPipe(pipe: string, handoff: Handoff, scheme: string, onHandoff: (h: Handoff) => void, waitMs: number): Promise<Instance> {
  const server = await serve(pipe, scheme, onHandoff, "win32").catch((e: unknown) => {
    if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") return null;
    throw e;
  });
  if (!server) return handOver(pipe, handoff, waitMs);
  if (handoff.kind === "link") onHandoff(handoff);
  let released = false;
  return {
    kind: "first",
    listening: true,
    release: () => {
      if (released) return;
      released = true;
      server.close();
    },
  };
}
