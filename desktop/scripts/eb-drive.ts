import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Driver {
  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A, ms?: number): Promise<R>;
  close(): void;
}

interface Waiting {
  ok: (v: unknown) => void;
  fail: (e: Error) => void;
}

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function appExecutable(path: string): string {
  const full = resolve(path);
  if (!full.endsWith(".app")) return full;
  const name = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", join(full, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
  return join(full, "Contents", "MacOS", name);
}

export function testEnv(root: string, socket: string, relay: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, CFFIXED_USER_HOME: home, KIWI_HOME: join(root, ".kiwi"), KIWI_EB_DRIVER: socket, KIWI_EB_RELAY: relay, ...extra };
  for (const name of ["BUN_OPTIONS", "BUN_INSPECT", "NODE_OPTIONS"]) if (!(name in extra)) delete env[name];
  return env;
}

export function launch(exe: string, env: NodeJS.ProcessEnv): ChildProcess {
  if (!existsSync(exe)) throw new Error(`no app at ${exe}`);
  return spawn(exe, [], { env, stdio: "ignore", detached: true });
}

export async function stop(app: ChildProcess): Promise<void> {
  const exited = new Promise<void>((done) => (app.exitCode !== null || app.signalCode !== null ? done() : app.once("exit", () => done())));
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-app.pid!, s);
    } catch {
      // The group is gone already: signal the app alone, which may have outlived it.
      app.kill(s);
    }
  };
  signal("SIGTERM");
  await Promise.race([exited, later(10_000)]);
  if (app.exitCode === null && app.signalCode === null) signal("SIGKILL");
}

export async function attach(socketPath: string, ms = 60_000): Promise<Driver> {
  const end = Date.now() + ms;
  const waiting = new Map<number, Waiting>();
  let buffered = "";
  let next = 0;
  const failAll = (why: string) => {
    for (const w of waiting.values()) w.fail(new Error(why));
    waiting.clear();
  };
  for (;;) {
    try {
      const socket = await Bun.connect({
        unix: socketPath,
        socket: {
          data(_socket, chunk) {
            const lines = (buffered + chunk.toString("utf8")).split("\n");
            buffered = lines.pop() ?? "";
            for (const line of lines) {
              const a = JSON.parse(line) as { id: number; ok: boolean; value?: unknown; error?: string };
              const w = waiting.get(a.id);
              waiting.delete(a.id);
              if (a.ok) w?.ok(a.value);
              else w?.fail(new Error(a.error ?? "the page's script failed"));
            }
          },
          close() {
            failAll("the app closed the driver's socket");
          },
        },
      });
      return {
        evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A, wait = 30_000): Promise<R> {
          const id = ++next;
          return new Promise<R>((ok, fail) => {
            const timer = setTimeout(() => {
              waiting.delete(id);
              fail(new Error(`the page didn't answer in ${wait / 1000}s`));
            }, wait);
            waiting.set(id, {
              ok: (v) => {
                clearTimeout(timer);
                ok(v as R);
              },
              fail: (e) => {
                clearTimeout(timer);
                fail(e);
              },
            });
            socket.write(`${JSON.stringify({ id, fn: fn.toString(), arg: JSON.stringify(arg ?? null) })}\n`);
          });
        },
        close() {
          socket.end();
        },
      };
    } catch (e) {
      if (Date.now() > end) throw new Error(`the app's test driver didn't open ${socketPath} in ${ms / 1000}s`, { cause: e });
      await later(100);
    }
  }
}

export async function until<T>(what: string, ms: number, probe: () => Promise<T | null>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe().catch(() => null);
    if (got !== null) return got;
    if (Date.now() > end) throw new Error(`${what}: nothing after ${ms / 1000}s`);
    await later(25);
  }
}
