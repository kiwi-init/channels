import { execFile } from "node:child_process";

export interface ToolRun {
  code: number;
  out: string;
}

export type RunTool = (cmd: string, args: string[]) => Promise<ToolRun>;

const runTool: RunTool = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: `${stdout}${stderr}` });
    });
  });

export function developerIdRequirement(out: string): string | null {
  const req = /^designated => (.+)$/m.exec(out)?.[1]?.trim();
  if (!req) return null;
  const bare = req.replace(/"[^"]*"/g, '""');
  if (/\bor\b|[()!]/.test(bare)) return null;
  return /\banchor apple generic\b/.test(bare) && /\bcertificate leaf\[subject\.OU\] = /.test(bare) ? req : null;
}

export async function signedLikeThisApp(running: string, next: string, run: RunTool = runTool): Promise<boolean> {
  const req = developerIdRequirement((await run("/usr/bin/codesign", ["-d", "-r-", running])).out);
  if (!req) return false;
  const verified = await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", `=${req}`, next]);
  if (verified.code !== 0) return false;
  return (await run("/usr/sbin/spctl", ["--assess", "--type", "execute", next])).code === 0;
}
