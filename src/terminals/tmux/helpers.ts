import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { hasLine, put, replaceFile, withLine, withoutLine } from "../shared/files.ts";
import { run } from "../shared/run.ts";
import { tmuxSocket } from "../shared/tmux.ts";

type Env = Record<string, string | undefined>;

const NAME = "kiwi.tmux.conf";
const MARK = "# Kiwi";
const SHOW = "terminal show --needs-you";
const FORMATS = ["window-status-format", "window-status-current-format"] as const;
export const MARK_FORMAT = "#{?@kiwi, #{@kiwi},}";

const quoted = (s: string): string => `"${s.replace(/[\\"$]/g, (c) => `\\${c}`)}"`;

export function tmuxConfigs(env: Env = process.env, home = homedir()): string[] {
  const explicit = env.KIWI_TMUX_CONF?.trim();
  if (explicit) return [explicit];
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return [...new Set([join(home, ".tmux.conf"), ...(xdg ? [join(xdg, "tmux", "tmux.conf")] : []), join(home, ".config", "tmux", "tmux.conf")])];
}

export function kiwiConfPath(conf: string): string {
  return join(dirname(conf), NAME);
}

export function sourceLine(conf: string): string {
  return `source-file -q ${quoted(kiwiConfPath(conf))} ${MARK}`;
}

function carries(conf: string): boolean {
  return existsSync(conf) && hasLine(readFileSync(conf, "utf8"), sourceLine(conf));
}

export function tmuxConfigPath(env: Env = process.env, home = homedir()): string {
  const confs = tmuxConfigs(env, home);
  return confs.find(carries) ?? confs.findLast((c) => existsSync(c)) ?? confs[0]!;
}

export function kiwiConf(kiwi: string): string {
  const formats = FORMATS.map((f) => `%if "#{==:#{m:*@kiwi*,#{${f}}},0}"\nset -ga ${f} ${quoted(MARK_FORMAT)}\n%endif`);
  const show = quoted(`${kiwi} ${SHOW}`.replaceAll("#", "##"));
  const key = `if-shell -b "! tmux -S '#{socket_path}' list-keys -T prefix K >/dev/null 2>&1" {\n  bind-key -T prefix K run-shell -b ${show}\n}`;
  return `${[...formats, key].join("\n")}\n`;
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

interface Live {
  tmux: string;
  sockets: readonly string[];
}

export async function downloadTmuxHelpers(kiwi: string, live: Live, conf = tmuxConfigPath()): Promise<{ conf: string; file: string; changed: boolean }> {
  const file = kiwiConfPath(conf);
  mkdirSync(dirname(conf), { recursive: true, mode: 0o700 });
  const wrote = put(file, kiwiConf(kiwi));
  const before = existsSync(conf) ? readFileSync(conf, "utf8") : "";
  const linked = hasLine(before, sourceLine(conf));
  if (!linked) replaceFile(conf, withLine(before, sourceLine(conf)));
  for (const socket of live.sockets) await run([live.tmux, "-u", "-S", socket, "source-file", "-q", file], 5_000);
  return { conf, file, changed: wrote || !linked };
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

export async function removeTmuxHelpers(live: Live, confs: readonly string[] = tmuxConfigs()): Promise<void> {
  for (const conf of confs) {
    rmSync(kiwiConfPath(conf), { force: true });
    if (!existsSync(conf)) continue;
    const before = readFileSync(conf, "utf8");
    const after = withoutLine(before, sourceLine(conf));
    if (!after) rmSync(conf, { force: true });
    else if (after !== before) replaceFile(conf, after);
  }
  for (const socket of live.sockets) await takeBack(live.tmux, socket);
}
