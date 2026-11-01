import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ShowResult, TmuxPlace } from "./plugin.ts";
import { shellWord } from "./shared/launch.ts";
import { run, type Ran } from "./shared/run.ts";

export function attachArgv(tmux: string, at: TmuxPlace): string[] {
  return [tmux, "-S", at.socket, "attach", "-t", at.pane, ";", "set", "-w", "window-size", "latest"];
}

export const attachLine = (argv: readonly string[]): string => argv.map((w) => (w === ";" ? "\\;" : shellWord(w))).join(" ");

export async function hostedTmuxBin(): Promise<string> {
  const [{ HostedTmux }, { home }] = await Promise.all([import("../daemon/hosted-tmux.ts"), import("../config/paths.ts")]);
  return new HostedTmux(home()).state()?.bin ?? "tmux";
}

export interface TerminalOpener {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  which: (bin: string) => string | null;
  run: (argv: readonly string[]) => Promise<Ran>;
  start: (argv: readonly string[]) => Promise<boolean>;
  write: (path: string, text: string) => boolean;
}

const LINUX_TERMINALS: readonly (readonly string[])[] = [
  ["x-terminal-emulator", "-e"],
  ["gnome-terminal", "--"],
  ["konsole", "-e"],
  ["xfce4-terminal", "-x"],
  ["ptyxis", "--"],
  ["kitty"],
  ["alacritty", "-e"],
  ["wezterm", "start", "--"],
  ["foot"],
  ["xterm", "-e"],
];

export function linuxTerminal(env: TerminalOpener["env"], which: TerminalOpener["which"]): string[] | null {
  const own = env.TERMINAL?.trim();
  if (own && which(own)) return [own, "-e"];
  const found = LINUX_TERMINALS.find(([bin]) => bin && which(bin));
  return found ? [...found] : null;
}

function started(argv: readonly string[]): Promise<boolean> {
  const [bin, ...args] = argv;
  if (!bin) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, args, { detached: true, stdio: "ignore" });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      // A terminal that can't even be spawned is one we can't open: say so and let the person copy the command.
      resolve(false);
    }
  });
}

function writeScript(path: string, text: string): boolean {
  try {
    writeFileSync(path, text, { mode: 0o700 });
    return true;
  } catch {
    // The hosted folder is gone or not ours: nothing to open, so the caller says the terminal didn't open.
    return false;
  }
}

const SYSTEM_OPENER: TerminalOpener = {
  platform: process.platform,
  env: process.env,
  which: (bin) => Bun.which(bin),
  run: (argv) => run(argv, 10_000),
  start: started,
  write: writeScript,
};

export async function showHosted(at: TmuxPlace, tmux: string, opener: TerminalOpener = SYSTEM_OPENER): Promise<ShowResult> {
  const found = await opener.run([tmux, "-S", at.socket, "display-message", "-p", "-t", at.pane, "#{pane_id}"]);
  if (found.status !== 0 || found.stdout.trim() !== at.pane) return { ok: false, why: found.status === null ? "failed" : "no-server" };
  const argv = attachArgv(tmux, at);
  if (opener.platform === "darwin") {
    const script = join(dirname(at.socket), `attach-${at.pane.slice(1)}.command`);
    if (!opener.write(script, `#!/bin/sh\nexec ${attachLine(argv)}\n`)) return { ok: false, why: "failed" };
    return (await opener.run(["open", script])).status === 0 ? { ok: true } : { ok: false, why: "no-app" };
  }
  if (opener.platform !== "linux") return { ok: false, why: "no-app" };
  const terminal = linuxTerminal(opener.env, opener.which);
  if (!terminal) return { ok: false, why: "no-app" };
  return (await opener.start([...terminal, ...argv])) ? { ok: true } : { ok: false, why: "no-app" };
}
