import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

export interface Proc {
  pid: number;
  ppid: number;
  start: string;
  args: string;
}

export function paneText(socket: string, pane: string): string {
  return tmuxNow(socket, ["capture-pane", "-p", "-t", pane]) ?? "";
}

export function typeInto(socket: string, pane: string, text: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "kiwi-loop-"));
  const buffer = `kiwi-loop-${process.pid}`;
  try {
    const file = join(dir, "prompt.txt");
    writeFileSync(file, text, { mode: 0o600 });
    if (tmuxNow(socket, ["load-buffer", "-b", buffer, file]) === null) return false;
    if (tmuxNow(socket, ["paste-buffer", "-p", "-d", "-b", buffer, "-t", pane]) === null) return false;
    return tmuxNow(socket, ["send-keys", "-t", pane, "Enter"]) !== null;
  } finally {
    tmuxNow(socket, ["delete-buffer", "-b", buffer]);
    rmSync(dir, { recursive: true, force: true });
  }
}

export function pasteBracketed(socket: string, pane: string): boolean {
  return tmuxNow(socket, ["display-message", "-p", "-t", pane, "#{bracket_paste_flag}"])?.trim() === "1";
}

export function clearPane(socket: string, pane: string): void {
  tmuxNow(socket, ["send-keys", "-R", "-t", pane]);
  tmuxNow(socket, ["clear-history", "-t", pane]);
}

export function paneIsOurs(socket: string, pane: string, procs: readonly Proc[] = processes()): boolean {
  const panePid = Number(tmuxNow(socket, ["display-message", "-p", "-t", pane, "#{pane_pid}"])?.trim());
  if (!Number.isInteger(panePid) || panePid <= 1) return false;
  const parent = new Map(procs.map((p) => [p.pid, p.ppid]));
  for (let pid: number | undefined = process.pid, hops = 0; pid !== undefined && pid > 1 && hops < 64; pid = parent.get(pid), hops++) {
    if (pid === panePid) return true;
  }
  return false;
}

export function processes(): Proc[] {
  const r = runNow(["env", "LC_ALL=C", "TZ=UTC0", "ps", "-eo", "pid=,ppid=,lstart=,args="], 5_000);
  if (r.status !== 0) return [];
  return r.stdout.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), start: m[3]!, args: m[4]! }] : [];
  });
}
