import { runNow } from "./run.ts";

type Env = Record<string, string | undefined>;

export function tmuxSocket(env: Env): string | undefined {
  return env.TMUX?.split(",")[0] || undefined;
}

export const hostedDir = (user = process.getuid?.() ?? 0): string => `/tmp/kiwi-${user}`;

export const onHostedSocket = (socket: string, user = process.getuid?.() ?? 0): boolean => socket.startsWith(`${hostedDir(user)}/`) || socket.startsWith(`/private${hostedDir(user)}/`);

export function tmuxNow(socket: string, args: readonly string[], env: Env = process.env): string | null {
  const r = runNow([env.KIWI_TMUX || "tmux", "-S", socket, ...args], 5_000);
  return r.status === 0 ? r.stdout : null;
}
