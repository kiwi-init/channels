import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const LISTENING = /relay listening on https?:\/\/[^\s/]+:(\d+)\//;

export interface LocalRelay {
  relay: ChildProcess;
  port: number;
}

export function relayPort(stdout: string): number | null {
  const port = Number(LISTENING.exec(stdout)?.[1]);
  return Number.isInteger(port) && port > 0 ? port : null;
}

export function startLocalRelay(data: string, web: string | null, opts: { rateLimits?: boolean } = {}): Promise<LocalRelay> {
  const flags = [...(web ? ["--web", web] : ["--no-web"]), "--dev-sign-in", ...(opts.rateLimits === false ? ["--dev-no-rate-limits"] : [])];
  const relay = spawn("bun", ["src/relay/bun.ts", "--hostname", "127.0.0.1", "--port", "0", "--data", data, ...flags], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((ok, fail) => {
    let out = "";
    relay.stdout!.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      if (!out.includes("site:")) return;
      const port = relayPort(out);
      if (port !== null) return ok({ relay, port });
      relay.kill();
      fail(new Error(`the relay didn't say its port: ${out.trim()}`));
    });
    relay.on("exit", (code) => fail(new Error(`relay exited (${code})`)));
  });
}
