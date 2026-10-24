import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Driver {
  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A, ms?: number): Promise<R>;
  main(name: string, ms?: number): Promise<unknown>;
  close(): void;
}

interface Waiting {
  ok: (v: unknown) => void;
  fail: (e: Error) => void;
}

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const LINUX_ENTRY = join("bin", "electrobun-launcher");

export function appExecutable(path: string): string {
  const full = resolve(path);
  if (existsSync(join(full, LINUX_ENTRY))) return join(full, LINUX_ENTRY);
  if (!full.endsWith(".app")) return full;
  const name = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", join(full, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
  return join(full, "Contents", "MacOS", name);
}

export function processesOf(app: string): string[] {
  const contents = `${resolve(app).replace(/\.app(\/.*)?$/, ".app")}/Contents/`;
  return execFileSync("ps", ["-Ao", "pid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes(contents));
}

export function webkitHelpers(): number {
  return execFileSync("ps", ["-Ao", "comm="], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.includes("/com.apple.WebKit.")).length;
}

export function testEnv(root: string, socket: string, relay: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const linux =
    process.platform === "linux"
      ? { XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share"), XDG_CACHE_HOME: join(home, ".cache"), XDG_STATE_HOME: join(home, ".local", "state") }
      : {};
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, CFFIXED_USER_HOME: home, ...linux, KIWI_HOME: join(root, ".kiwi"), KIWI_EB_DRIVER: socket, KIWI_EB_RELAY: relay, ...extra };
  for (const name of ["BUN_OPTIONS", "BUN_INSPECT", "NODE_OPTIONS"]) if (!(name in extra)) delete env[name];
  return env;
}

export function appRoot(exe: string): string {
  if (exe.includes(".app/")) return exe.slice(0, exe.indexOf(".app/") + 4);
  return exe.endsWith(`/${LINUX_ENTRY}`) ? dirname(dirname(exe)) : exe;
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
              let a: { id: number; ok: boolean; value?: unknown; error?: string };
              try {
                a = JSON.parse(line) as { id: number; ok: boolean; value?: unknown; error?: string };
              } catch {
                // A line that isn't JSON answers nothing: the call it was meant for times out with its own error.
                continue;
              }
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
      const ask = (fields: Record<string, string>, who: string, wait: number): Promise<unknown> => {
        const id = ++next;
        return new Promise<unknown>((ok, fail) => {
          const timer = setTimeout(() => {
            waiting.delete(id);
            fail(new Error(`${who} didn't answer in ${wait / 1000}s`));
          }, wait);
          waiting.set(id, {
            ok: (v) => {
              clearTimeout(timer);
              ok(v);
            },
            fail: (e) => {
              clearTimeout(timer);
              fail(e);
            },
          });
          socket.write(`${JSON.stringify({ id, ...fields })}\n`);
        });
      };
      return {
        evaluate: <A, R>(fn: (arg: A) => R | Promise<R>, arg: A, wait = 30_000): Promise<R> => ask({ fn: fn.toString(), arg: JSON.stringify(arg ?? null) }, "the page", wait) as Promise<R>,
        main: (name: string, wait = 5_000): Promise<unknown> => ask({ main: name }, "the app's main", wait),
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
