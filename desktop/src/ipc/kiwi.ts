import { execFile } from "node:child_process";

import { kiwiCli } from "../bundled-daemon.ts";

export function runKiwi(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return kiwiCli().then(
    (bin) =>
      new Promise((resolve) => {
        execFile(bin, args, { timeout: 15_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          const code = err && typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
          resolve({ code, stdout: typeof stdout === "string" ? stdout : "", stderr: typeof stderr === "string" ? stderr : "" });
        });
      }),
    () => ({ code: 1, stdout: "", stderr: "" }),
  );
}
