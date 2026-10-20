import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const CODEX_NEW = "/new";
export const CODEX_FIRST = "Kiwi started this fresh session; carry on from above.";

const COMPOSER = /^\x1b\[(?:0;)?1m›\x1b\[0m(?: (.*))?$/;
const PLACEHOLDER = /^\x1b\[2m[^\x1b]*\x1b\[0m$/;
const FOOTER = / · /;
const SPINNER = /^(?:[\u2800-\u28ff]\s*)+/;

const plain = (line: string) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u00a0/g, " ");

export function codexInput(captured: string): string | null {
  const lines = captured.split("\n");
  const at = lines.findLastIndex((l) => COMPOSER.test(l));
  if (at < 0) return null;
  const below = lines.slice(at + 1).map(plain);
  let end = below.length;
  while (end > 0 && !below[end - 1]!.trim()) end--;
  let footer = end;
  while (footer > 0 && below[footer - 1]!.trim()) footer--;
  if (footer === end || !FOOTER.test(below[footer]!)) return null;
  const draft = below.slice(0, footer);
  if (draft.at(-1)?.trim() === "") draft.pop();
  const first = COMPOSER.exec(lines[at]!)?.[1] ?? "";
  return [PLACEHOLDER.test(first) ? "" : plain(first), ...draft.map((l) => l.replace(/^ {2}/, ""))].join("\n");
}

export const sameWords = (a: string, b: string) => a.replace(/\s+/g, " ") === b.replace(/\s+/g, " ");

export type Shown = { kind: "busy" } | { kind: "unnamed" } | { kind: "named"; name: string };

export function codexShown(title: string): Shown {
  if (SPINNER.test(title)) return { kind: "busy" };
  const cut = title.lastIndexOf(" | ");
  return cut < 0 ? { kind: "unnamed" } : { kind: "named", name: title.slice(0, cut) };
}

export function codexHome(rollout: string): string {
  return join(dirname(rollout), "..", "..", "..", "..");
}

export function threadName(home: string, thread: string): string | null {
  let index: string;
  try {
    index = readFileSync(join(home, "session_index.jsonl"), "utf8");
  } catch {
    // No index yet: no thread has a name.
    return null;
  }
  let name: string | null = null;
  for (const line of index.split("\n")) {
    if (!line.includes(thread)) continue;
    try {
      const row = JSON.parse(line) as { id?: unknown; thread_name?: unknown };
      if (row.id === thread && typeof row.thread_name === "string" && row.thread_name) name = row.thread_name;
    } catch {
      // A row cut mid-write: the rows before it still name the thread.
    }
  }
  return name;
}

export function originator(rollout: string): string | null {
  let head: string;
  try {
    head = readFileSync(rollout, "utf8").split("\n", 1)[0] ?? "";
  } catch {
    // No rollout: its originator is unknown.
    return null;
  }
  try {
    const meta = JSON.parse(head) as { type?: unknown; payload?: { originator?: unknown } };
    return meta.type === "session_meta" && typeof meta.payload?.originator === "string" ? meta.payload.originator : null;
  } catch {
    // A first line still being written: unknown for now.
    return null;
  }
}

export function createdAt(thread: string): number | null {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(thread);
  return m ? Number.parseInt(m[1]! + m[2]!, 16) : null;
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
