import { shellQuote } from "../hooks/self.ts";
import { runNow } from "../loop/tmux.ts";
import type { SeatAt, Startable } from "./plan.ts";

export interface Launcher {
  name: string;
  open: (at: SeatAt, argv: readonly string[], env?: Readonly<Record<string, string>>) => string | null;
}

const TMUX_SESSION = "kiwi";

export function tmuxLauncher(tmux: string, env: Record<string, string | undefined> = process.env, run: typeof runNow = runNow): Launcher {
  const inside = !!env.TMUX;
  return {
    name: "tmux",
    open: (at, argv, env = {}) => {
      const fresh = !inside && run([tmux, "has-session", "-t", `=${TMUX_SESSION}`]).status !== 0;
      const where = inside ? [] : fresh ? ["new-session", "-d", "-s", TMUX_SESSION] : ["new-window", "-d", "-t", `=${TMUX_SESSION}:`];
      const r = run([
        tmux,
        ...(inside ? ["new-window", "-d"] : where),
        "-P",
        "-F",
        "#{window_id}",
        "-c",
        at.dir,
        "-n",
        at.as,
        ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
        ...argv,
      ]);
      if (r.status !== 0) return r.stderr.trim() || `tmux exited with ${r.status ?? "a signal"}`;
      const window = r.stdout.trim();
      if (window) run([tmux, "set-option", "-w", "-t", window, "remain-on-exit", "failed"]);
      return null;
    },
  };
}

export function seatArgv(kiwi: readonly string[], p: Startable, run: { bindSeconds?: number; report?: string } = {}): string[] {
  if (p.kind === "loop") return [...kiwi, "loop", "--harness", p.harness, "-c", p.alias, "--as", p.as];
  return [...kiwi, "up", "--seat", p.as, "-c", p.alias, ...(run.bindSeconds !== undefined ? ["--bind-timeout", String(run.bindSeconds)] : []), ...(run.report ? ["--report", run.report] : [])];
}

const PLAIN_WORD = /^[\w@%+=:,./-]+$/;

const word = (s: string): string => (PLAIN_WORD.test(s) ? s : shellQuote(s));

export function printedLine(p: Startable): string {
  const line = seatArgv(["kiwi"], p).map(word).join(" ");
  return p.kind === "restore" ? line : `cd ${word(p.dir)} && ${line}`;
}
