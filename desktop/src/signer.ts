import { execFile } from "node:child_process";

export interface ToolResult {
  code: number;
  out: string;
}

export type RunTool = (cmd: string, args: string[]) => Promise<ToolResult>;

const CODESIGN = "/usr/bin/codesign";
const SPCTL = "/usr/sbin/spctl";

const runTool: RunTool = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, out: `${stdout}\n${stderr}` });
    });
  });

export function designatedRequirement(out: string): string | null {
  const line = out.split("\n").find((l) => l.trim().startsWith("designated =>"));
  const req = line?.trim().slice("designated =>".length).trim();
  return req || null;
}

export function developerTeam(requirement: string): string | null {
  if (!/\banchor apple generic\b/.test(requirement)) return null;
  return /certificate leaf\[subject\.OU\]\s*=\s*"?([A-Z0-9]{10})"?/.exec(requirement)?.[1] ?? null;
}

export async function signedLikeThis(running: string, next: string, run: RunTool = runTool): Promise<boolean> {
  const own = await run(CODESIGN, ["-d", "-r-", running]);
  const requirement = own.code === 0 ? designatedRequirement(own.out) : null;
  if (!requirement || !developerTeam(requirement)) return false;
  const verified = await run(CODESIGN, ["--verify", "--deep", "--strict", "-R", `=${requirement}`, next]);
  if (verified.code !== 0) return false;
  const assessed = await run(SPCTL, ["--assess", "--type", "execute", next]);
  return assessed.code === 0;
}
