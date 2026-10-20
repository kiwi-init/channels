import { spawnSync } from "node:child_process";
import { existsSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CODEX_NEW = "/new";
export const CODEX_FIRST = "Kiwi started this fresh session; carry on from above.";

const COMPOSER = /^\x1b\[(?:0;)?1m›\x1b\[0m(?: (.*))?$/;
const PLACEHOLDER = /^\x1b\[2m[^\x1b]*\x1b\[0m$/;
const CONTINUED = /^ {4}/;

const plain = (line: string) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/ /g, " ");

export function codexInput(captured: string): string | null {
  const lines = captured.split("\n");
  const at = lines.findLastIndex((l) => COMPOSER.test(l));
  if (at < 0) return null;
  const first = COMPOSER.exec(lines[at]!)?.[1] ?? "";
  const rest: string[] = [];
  for (let i = at + 1; i < lines.length && plain(lines[i]!).trim(); i++) {
    if (!CONTINUED.test(plain(lines[i]!))) break;
    rest.push(plain(lines[i]!).slice(4));
  }
  if (!rest.length && (first === "" || PLACEHOLDER.test(first))) return "";
  return [plain(first), ...rest].join("\n").trimEnd();
}

export interface CodexPane {
  pid: number;
  pane: string;
  socket: string;
}

function real(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    // A folder that's gone matches no pane.
    return null;
  }
}

function cwdOf(pid: number): string | null {
  try {
    return real(readlinkSync(`/proc/${pid}/cwd`));
  } catch {
    // No /proc (macOS): ask lsof instead.
  }
  const r = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8", timeout: 2_000 });
  const line = r.status === 0 ? r.stdout.split("\n").find((l) => l.startsWith("n")) : undefined;
  return line ? real(line.slice(1)) : null;
}

function leader(tty: string): number | null {
  const r = spawnSync("ps", ["-t", tty.replace(/^\/dev\//, ""), "-o", "pid=,pgid=,tpgid=,comm="], { encoding: "utf8", timeout: 2_000 });
  if (r.status !== 0) return null;
  for (const row of r.stdout.split("\n")) {
    const [pid, pgid, tpgid, comm] = row.trim().split(/\s+/);
    if (pid && pid === pgid && pid === tpgid && comm?.split("/").at(-1) === "codex") return Number(pid);
  }
  return null;
}

export function sockets(env: Record<string, string | undefined>, uid = process.getuid?.() ?? 0): string[] {
  const own = env.TMUX?.split(",")[0];
  const fallback = join(env.TMUX_TMPDIR || (process.platform === "darwin" ? tmpdir() : "/tmp"), `tmux-${uid}`, "default");
  return [...new Set([own, fallback].filter((s): s is string => !!s && existsSync(s)))];
}

export function codexPanes(cwd: string, where: readonly string[]): CodexPane[] {
  const want = real(cwd);
  if (!want) return [];
  return where.flatMap((socket) => {
    const r = spawnSync("tmux", ["-S", socket, "list-panes", "-a", "-F", "#{pane_id} #{pane_tty}"], { encoding: "utf8", timeout: 5_000 });
    if (r.status !== 0) return [];
    return r.stdout.split("\n").flatMap((row): CodexPane[] => {
      const [pane, tty] = row.trim().split(" ");
      if (!pane || !tty || !/^%\d+$/.test(pane)) return [];
      const pid = leader(tty);
      return pid !== null && cwdOf(pid) === want ? [{ pid, pane, socket }] : [];
    });
  });
}

export function codexPane(cwd: string, where: readonly string[]): CodexPane | null {
  const found = codexPanes(cwd, where);
  return found.length === 1 ? found[0]! : null;
}
