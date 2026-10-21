import { runNow } from "./run.ts";

type Env = Record<string, string | undefined>;

export function tmuxSocket(env: Env): string | undefined {
  return env.TMUX?.split(",")[0] || undefined;
}

export function tmuxNow(socket: string, args: readonly string[]): string | null {
  const r = runNow(["tmux", "-S", socket, ...args], 5_000);
  return r.status === 0 ? r.stdout : null;
}
