import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { allSeats, loadConfig, updateConfig } from "../../config.ts";
import { loginPath } from "../../launch/shell.ts";
import { replaceFile, withoutLine } from "../shared/files.ts";
import { run } from "../shared/run.ts";
import { onHostedSocket, tmuxSocket } from "../shared/tmux.ts";

type Env = Record<string, string | undefined>;

const NAME = "kiwi.tmux.conf";
const MARK = "# Kiwi";
const SHOW = "terminal show --needs-you";
const FORMATS = ["window-status-format", "window-status-current-format"] as const;
export const MARK_FORMAT = "#{?@kiwi, #{@kiwi},}";

const quoted = (s: string): string => `"${s.replace(/[\\"$]/g, (c) => `\\${c}`)}"`;

function tmuxConfigs(env: Env = process.env, home = homedir()): string[] {
  const explicit = env.KIWI_TMUX_CONF?.trim();
  if (explicit) return [explicit];
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return [...new Set([join(home, ".tmux.conf"), ...(xdg ? [join(xdg, "tmux", "tmux.conf")] : []), join(home, ".config", "tmux", "tmux.conf")])];
}

export function sourceLine(conf: string): string {
  return `source-file -q ${quoted(join(dirname(conf), NAME))} ${MARK}`;
}

export function liveSockets(seats: readonly string[], env: Env = process.env): string[] {
  const own = join(env.TMUX_TMPDIR || "/tmp", `tmux-${process.getuid?.() ?? 0}`, "default");
  const real = (socket: string): string[] => {
    try {
      const path = join(realpathSync(dirname(socket)), basename(socket));
      return existsSync(path) ? [path] : [];
    } catch {
      // No folder there means no server running to change.
      return [];
    }
  };
  return [...new Set([tmuxSocket(env), own, ...seats].flatMap((s) => (s ? real(s) : [])))];
}

async function takeBack(tmux: string, socket: string): Promise<void> {
  const cmd = (...args: string[]) => run([tmux, "-u", "-S", socket, ...args], 5_000);
  const windows = await cmd("list-windows", "-a", "-F", "#{window_id}");
  if (windows.status !== 0) return;
  for (const id of windows.stdout.split("\n").filter((w) => /^@\d+$/.test(w))) await cmd("set-option", "-wu", "-t", id, "@kiwi");
  for (const name of FORMATS) {
    const got = await cmd("show-options", "-gv", name);
    const now = got.stdout.replace(/\n$/, "");
    if (got.status === 0 && now.endsWith(MARK_FORMAT)) await cmd("set-option", "-g", name, now.slice(0, -MARK_FORMAT.length));
  }
  const key = await cmd("list-keys", "-T", "prefix", "K");
  if (key.status === 0 && key.stdout.includes(SHOW)) await cmd("unbind-key", "-T", "prefix", "K");
}

export async function forgetTmuxHelpers(live: { tmux: string | null; sockets: readonly string[] }, confs: readonly string[] = tmuxConfigs()): Promise<void> {
  for (const conf of confs) {
    rmSync(join(dirname(conf), NAME), { force: true });
    if (!existsSync(conf)) continue;
    const before = readFileSync(conf, "utf8");
    const after = withoutLine(before, sourceLine(conf));
    if (!after) rmSync(conf, { force: true });
    else if (after !== before) replaceFile(conf, after);
  }
  if (live.tmux) for (const socket of live.sockets) await takeBack(live.tmux, socket);
}

export async function dropTmuxHelpers(env: Env = process.env, tmux?: string | null): Promise<boolean> {
  const cfg = loadConfig();
  if (cfg.terminals?.helpers?.tmux === undefined) return false;
  const seats = allSeats(cfg).flatMap((r) => (r.tmux && !onHostedSocket(r.tmux.socket) ? [r.tmux.socket] : []));
  await forgetTmuxHelpers({ tmux: tmux === undefined ? Bun.which("tmux", { PATH: await loginPath() }) : tmux, sockets: liveSockets(seats, env) }, tmuxConfigs(env));
  updateConfig((c) => {
    const helpers = { ...c.terminals?.helpers };
    delete helpers.tmux;
    c.terminals = { ...c.terminals, helpers };
  });
  return true;
}
