import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readlinkSync, readSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const CODEX_NEW = "/new";
export const CODEX_FIRST = "Kiwi started this fresh session; carry on from above.";

const SPINNER = /^(?:[\u2800-\u28ff]\s*)+/;
const THREAD_ID = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Style = { bold: boolean; dim: boolean; reverse: boolean; color: boolean };
type Run = Style & { text: string };

const PLAIN: Style = { bold: false, dim: false, reverse: false, color: false };

function styled(was: Style, params: string): Style {
  const p = params === "" ? [0] : params.split(";").map(Number);
  let s = { ...was };
  for (let i = 0; i < p.length; i++) {
    const v = p[i]!;
    const skip = p[i + 1] === 5 ? 2 : p[i + 1] === 2 ? 4 : 0;
    if (v === 0) s = { ...PLAIN };
    else if (v === 1) s.bold = true;
    else if (v === 2) s.dim = true;
    else if (v === 22) s = { ...s, bold: false, dim: false };
    else if (v === 7) s.reverse = true;
    else if (v === 27) s.reverse = false;
    else if (v === 39) s.color = false;
    else if ((v >= 30 && v <= 37) || (v >= 90 && v <= 97)) s.color = true;
    else if (v === 38) {
      s.color = true;
      i += skip;
    } else if (v === 48 || v === 58) i += skip;
  }
  return s;
}

function runs(line: string): Run[] {
  const out: Run[] = [];
  let style = PLAIN;
  let last = 0;
  for (const m of line.matchAll(/\x1b\[([0-9;?]*)([A-Za-z])/g)) {
    if (m.index > last) out.push({ ...style, text: line.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[2] === "m" && !m[1]!.includes("?")) style = styled(style, m[1]!);
  }
  if (last < line.length) out.push({ ...style, text: line.slice(last) });
  return out;
}

const plain = (line: string) => line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\u00a0/g, " ");

function boxLine(line: string): Run[] | null {
  const all = runs(line);
  const at = all.findIndex((r) => r.text.length > 0);
  const head = all[at];
  if (!head || !head.text.startsWith("›") || !head.bold || head.dim || head.reverse) return null;
  return [{ ...head, text: head.text.slice(1) }, ...all.slice(at + 1)];
}

function shownPaths(cwd: string): string[] {
  const home = homedir();
  const paths = [...new Set([cwd, real(cwd) ?? cwd])];
  return [...new Set(paths.flatMap((p) => (p === home || p.startsWith(`${home}/`) ? [p, `~${p.slice(home.length)}`] : [p])))];
}

function isFooter(line: string, cwd: string): boolean {
  const all = runs(line);
  const text = plain(line);
  return shownPaths(cwd).some((p) => text.includes(` · ${p}`) && all.some((r) => r.color && r.text.trim() === p));
}

export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

export function codexInput(captured: string, cwd: string): string | null {
  const lines = captured.split("\n");
  const at = lines.findLastIndex((l) => boxLine(l) !== null);
  if (at < 0) return null;
  const below = lines.slice(at + 1);
  let end = below.length;
  while (end > 0 && !plain(below[end - 1]!).trim()) end--;
  let footer = end;
  while (footer > 0 && plain(below[footer - 1]!).trim()) footer--;
  if (footer === end || !isFooter(below[footer]!, cwd)) return null;
  const draft = below.slice(0, footer).map(plain);
  if (draft.at(-1)?.trim() === "") draft.pop();
  const rest = boxLine(lines[at]!) ?? [];
  const placeholder = rest.every((r) => r.dim || !r.text.trim());
  const first = placeholder ? "" : plain(rest.map((r) => r.text).join("")).replace(/^ /, "");
  return [first, ...draft.map((l) => l.replace(/^ {2}/, ""))].join("\n");
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
      const row: unknown = JSON.parse(line);
      if (isRecord(row) && row.id === thread && typeof row.thread_name === "string" && row.thread_name) name = row.thread_name;
    } catch {
      // A row cut mid-write: the rows before it still name the thread.
    }
  }
  return name;
}

function firstLine(file: string, max = 1 << 20): string | null {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    // No rollout: nothing to read.
    return null;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    while (size < max) {
      const buf = Buffer.alloc(64 * 1024);
      const n = readSync(fd, buf, 0, buf.length, size);
      if (n === 0) return null;
      const nl = buf.subarray(0, n).indexOf(10);
      chunks.push(buf.subarray(0, nl < 0 ? n : nl));
      if (nl >= 0) return Buffer.concat(chunks).toString("utf8");
      size += n;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

export type SessionMeta = { originator: string; cwd: string };

export function sessionMeta(rollout: string): SessionMeta | null {
  const head = firstLine(rollout);
  if (!head) return null;
  try {
    const meta: unknown = JSON.parse(head);
    const payload = isRecord(meta) && meta.type === "session_meta" && isRecord(meta.payload) ? meta.payload : null;
    const originator = payload?.originator;
    const cwd = payload?.cwd;
    return typeof originator === "string" && originator && typeof cwd === "string" && cwd ? { originator, cwd } : null;
  } catch {
    // A first line that isn't JSON: no session to read.
    return null;
  }
}

export function createdAt(thread: string): number | null {
  const m = THREAD_ID.exec(thread);
  return m ? Number.parseInt(m[1]! + m[2]!, 16) : null;
}

export function threadOf(file: string): string | null {
  const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file)?.[1];
  return id && THREAD_ID.test(id) ? id : null;
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
