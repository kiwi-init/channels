import { execFile } from "node:child_process";

import { kiwiCli } from "../bundled-daemon.ts";
import { childEnv } from "../child-env.ts";

export function runKiwi(args: string[], timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return kiwiCli().then(
    (bin) =>
      new Promise((resolve) => {
        execFile(bin, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: childEnv() }, (err, stdout, stderr) => {
          const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
          resolve({ code, stdout: typeof stdout === "string" ? stdout : "", stderr: typeof stderr === "string" ? stderr : "" });
        });
      }),
    () => ({ code: 1, stdout: "", stderr: "" }),
  );
}
