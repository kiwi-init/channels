import { spawnSync } from "node:child_process";

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

const failed = (err: unknown): Ran => ({ status: null, stdout: "", stderr: err instanceof Error ? err.message : String(err) });

export function runNow(argv: readonly string[], timeoutMs = 5_000): Ran {
  const [bin, ...args] = argv;
  if (!bin) return failed("nothing to run");
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: timeoutMs });
  return {
    status: typeof r.status === "number" ? r.status : null,
    stdout: typeof r.stdout === "string" ? r.stdout : "",
    stderr: typeof r.stderr === "string" && r.stderr ? r.stderr : (r.error?.message ?? ""),
  };
}

type Env = Record<string, string | undefined>;

export function tmuxSocket(env: Env): string | undefined {
  return env.TMUX?.split(",")[0] || undefined;
}

export function tmuxNow(socket: string, args: readonly string[], env: Env = process.env): string | null {
  const r = runNow([env.KIWI_TMUX || "tmux", "-u", "-S", socket, ...args], 5_000);
  return r.status === 0 ? r.stdout : null;
}
