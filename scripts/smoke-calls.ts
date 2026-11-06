import { spawn } from "node:child_process";

const tail = (out: string): string => out.trim().split("\n").slice(-5).join(" | ") || "no output";

export class CallTimedOut extends Error {
  constructor(
    readonly call: string,
    readonly out: string,
    limitMs: number,
  ) {
    super(`${call} was still running after ${limitMs} ms, so it was killed; its output: ${tail(out)}`);
  }
}

export class CallExited extends Error {
  constructor(
    readonly call: string,
    readonly code: number | null,
    readonly out: string,
  ) {
    super(`${call} exited ${code}: ${tail(out)}`);
  }
}

export class CallNotStarted extends Error {
  constructor(
    readonly call: string,
    cause: Error,
  ) {
    super(`${call} didn't start: ${cause.message}`);
  }
}

export class DeadlinePassed extends Error {
  constructor(what: string, deadlineMs: number, seen: string) {
    super(`${what}: not within ${deadlineMs} ms; last seen: ${seen}`);
  }
}

export interface Call {
  cmd: string;
  args: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  limitMs: number;
  name?: string;
  watch?: (out: string) => void;
}

export function runCall(c: Call): Promise<string> {
  const call = c.name ?? [c.cmd, ...c.args].join(" ");
  return new Promise((ok, fail) => {
    const p = spawn(c.cmd, [...c.args], { cwd: c.cwd, env: c.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let late = false;
    const on = (d: Buffer) => {
      out += d.toString("utf8");
      c.watch?.(out);
    };
    p.stdout.on("data", on);
    p.stderr.on("data", on);
    const timer = setTimeout(
      () => {
        late = true;
        p.kill("SIGKILL");
      },
      Math.max(0, c.limitMs),
    );
    const done = () => {
      clearTimeout(timer);
      p.stdout.off("data", on);
      p.stderr.off("data", on);
      p.stdout.destroy();
      p.stderr.destroy();
    };
    p.once("error", (e) => {
      done();
      fail(new CallNotStarted(call, e));
    });
    p.once("exit", (code) => {
      done();
      if (late) fail(new CallTimedOut(call, out, c.limitMs));
      else if (code === 0) ok(out);
      else fail(new CallExited(call, code, out));
    });
  });
}

export type Attempt<T> = { done: true; value: T } | { done: false; seen: string };

export async function poll<T>(what: string, deadlineMs: number, pauseMs: number, attempt: (limitMs: number) => Promise<Attempt<T>>): Promise<T> {
  const end = performance.now() + deadlineMs;
  let seen = "nothing yet";
  for (;;) {
    const left = Math.floor(end - performance.now());
    if (left <= 0) throw new DeadlinePassed(what, deadlineMs, seen);
    const r = await attempt(left);
    if (r.done) return r.value;
    seen = r.seen;
    const pause = Math.min(pauseMs, end - performance.now());
    if (pause > 0) await Bun.sleep(pause);
  }
}
