import { statSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { rexBinary, type RexPlace } from "../rex.ts";
import { loginPath, loginShell } from "./shell.ts";

export type PlaceKind = "rex" | "tmux" | "terminal";

export interface PlaceRequest {
  argv: string[];
  folder: string;
  name: string;
  env?: Record<string, string>;
}

export type Placed =
  | { ok: true; place: "rex"; rex: RexPlace; window: string; pid?: number }
  | { ok: true; place: "tmux"; socket: string; session: string; window: string; pane: string; pid?: number }
  | { ok: true; place: "terminal"; window?: number }
  | { ok: false; why: "bad-request" | "no-place" | "not-allowed" | "failed"; detail: string };

export interface PlaceTools {
  platform: NodeJS.Platform;
  shell: string;
  rex: string | null;
  tmux: string | null;
  socket?: string;
  osascript: string | null;
}

async function placeTools(): Promise<PlaceTools> {
  return {
    platform: process.platform,
    shell: loginShell(),
    rex: rexBinary(),
    tmux: Bun.which("tmux", { PATH: await loginPath() }),
    osascript: process.platform === "darwin" ? (Bun.which("osascript") ?? "/usr/bin/osascript") : null,
  };
}

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

async function run(argv: string[], ms = 10_000): Promise<Ran> {
  try {
    const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), ms);
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    clearTimeout(timer);
    return { status, stdout, stderr };
  } catch (err) {
    return { status: null, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

const said = (r: Ran): string => (r.stderr.trim() || r.stdout.trim() || `exit ${r.status}`).split("\n")[0]!.slice(0, 200);

const CONTROL = /[\x00-\x1f\x7f]/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function badRequest(req: PlaceRequest): string | null {
  const program = req.argv[0];
  if (!program) return "nothing to run";
  if (program.startsWith("-") || program.includes("=")) return `"${program}" is not a program`;
  if (req.argv.some((arg) => CONTROL.test(arg))) return "the command has a control character";
  if (!req.name || req.name.length > 64 || CONTROL.test(req.name)) return "the window's name is empty, too long or has a control character";
  if (!isAbsolute(req.folder) || CONTROL.test(req.folder) || !isDir(req.folder)) return `${req.folder} is not a folder`;
  for (const [key, value] of Object.entries(req.env ?? {})) if (!ENV_KEY.test(key) || CONTROL.test(value)) return `the variable ${key} can't be set`;
  return null;
}

const POSIX = new Set(["sh", "bash", "zsh", "ksh", "mksh", "dash", "yash"]);

const SESSION_MARKERS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SSE_PORT",
  "CODEX_THREAD_ID",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "GROK_SESSION_ID",
  "GEMINI_CLI",
  "CURSOR_AGENT",
  "CURSOR_CONVERSATION_ID",
  "CURSOR_TRACE_ID",
  "OPENCODE",
  "OPENCODE_SESSION_ID",
  "PI_CODING_AGENT",
  "MIMOCODE",
  "MIMOCODE_PID",
  "MIMOCODE_SESSION_ID",
  "KIWI_AS",
  "KIWI_HARNESS",
  "KIWI_MODEL",
  "KIWI_PI_PID",
  "KIWI_PI_SESSION",
];

const pairs = (env: Record<string, string>): string[] => Object.entries(env).map(([key, value]) => `${key}=${value}`);

export function loginArgv(shell: string, argv: readonly string[], env: Record<string, string> = {}): string[] {
  const name = basename(shell);
  const login = name === "fish" ? [shell, "-ilc", "exec $argv"] : [POSIX.has(name) ? shell : "/bin/sh", "-ilc", 'exec "$@"', "kiwi-launch"];
  return ["/usr/bin/env", ...SESSION_MARKERS.flatMap((key) => ["-u", key]), ...pairs(env), ...login, ...argv];
}

function quote(word: string, fish: boolean): string {
  return fish ? `'${word.replace(/[\\']/g, "\\$&")}'` : `'${word.replace(/'/g, "'\\''")}'`;
}

export function terminalLine(shell: string, req: PlaceRequest): string {
  const fish = basename(shell) === "fish";
  const env = pairs(req.env ?? {});
  return `cd ${quote(req.folder, fish)} && exec ${[...(env.length ? ["env", ...env] : []), ...req.argv].map((word) => quote(word, fish)).join(" ")}`;
}

function object(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function list(v: unknown, key: string): Record<string, unknown>[] {
  const items = object(v)?.[key];
  return Array.isArray(items)
    ? items.flatMap((item: unknown) => {
        const o = object(item);
        return o ? [o] : [];
      })
    : [];
}

function parse(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

const SESSION = /^session:[0-9a-f-]{36}$/;
const BLOCK = /^block:[0-9a-f-]{36}$/;
const TERMINAL = "com.superlogical.terminal";

async function rex(
  t: PlaceTools & { rex: string },
  server: string | null,
  method: string,
  args: Record<string, unknown>,
  session?: string,
): Promise<{ ok: true; value: unknown } | { ok: false; detail: string }> {
  const r = await run([t.rex, ...(server ? ["-S", server] : []), "--autostart=false", "api", "call", ...(session ? ["-s", session] : []), method, JSON.stringify(args)]);
  return r.status === 0 ? { ok: true, value: parse(r.stdout) } : { ok: false, detail: `Rex ${method}: ${said(r)}` };
}

async function rexServer(t: PlaceTools): Promise<string | null> {
  if (!t.rex) return null;
  const r = await run([t.rex, "--autostart=false", "whoami", "--json"], 5_000);
  const endpoint = r.status === 0 ? object(parse(r.stdout))?.endpoint : null;
  return typeof endpoint === "string" && endpoint ? endpoint : null;
}

const REX_PLATFORM: Partial<Record<NodeJS.Platform, string>> = { darwin: "macos", linux: "linux", win32: "windows" };

async function rexSession(t: PlaceTools & { rex: string }, server: string): Promise<string | null> {
  const clients = await rex(t, server, "client.list", { kinds: ["app"] });
  const here = REX_PLATFORM[t.platform];
  const apps = (clients.ok ? list(clients.value, "clients") : [])
    .filter((c) => object(c.info)?.kind === "app" && c.connection_state !== "lost")
    .map((c) => ({
      here: object(c.info)?.platform === here,
      at: typeof c.connected_at === "string" ? Date.parse(c.connected_at) || 0 : 0,
      sessions: Array.isArray(c.session_ids) ? c.session_ids : [],
    }))
    .sort((a, b) => Number(b.here) - Number(a.here) || b.at - a.at);
  const attached = apps.flatMap((app) => app.sessions).find((id): id is string => typeof id === "string" && SESSION.test(id));
  if (attached) return attached;
  const sessions = await rex(t, server, "session.list", {});
  const last = (sessions.ok ? list(sessions.value, "sessions") : []).map((s) => s.session_id).findLast((id): id is string => typeof id === "string" && SESSION.test(id));
  if (last) return last;
  const made = await rex(t, server, "session.create", { label: "kiwi" });
  const id = made.ok ? object(made.value)?.session_id : null;
  return typeof id === "string" && SESSION.test(id) ? id : null;
}

async function openRex(t: PlaceTools & { rex: string }, server: string, req: PlaceRequest): Promise<Placed> {
  const session = await rexSession(t, server);
  if (!session) return { ok: false, why: "failed", detail: "Rex has no session to open a window in" };
  const command = loginArgv(t.shell, req.argv, req.env);
  const block = { flavor: `${TERMINAL}.shell`, label: req.name, options: { shell: "none", login: false, command, cwd: req.folder } };
  const made = await rex(t, server, "session.new_window", { session_id: session, focus: false, window_label: req.name, layout: { block } });
  if (!made.ok) return { ok: false, why: "failed", detail: made.detail };
  const window = object(made.value)?.window_id;
  const id = (object(made.value)?.block_ids as unknown[] | undefined)?.[0];
  if (typeof window !== "string" || typeof id !== "string" || !BLOCK.test(id)) return { ok: false, why: "failed", detail: "Rex opened a window but didn't say which" };
  const proc = await rex(t, server, `${TERMINAL}.process`, { block_id: id, args: {} }, session);
  const pid = Number(object(object(proc.ok ? proc.value : null)?.child)?.pid);
  return { ok: true, place: "rex", rex: { server, session, block: id }, window, ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}) };
}

const TMUX_SESSION = "kiwi";
const TMUX_FORMAT = "#{socket_path}\t#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_pid}";
const NO_SESSION = /error connecting to|no server running|can't find session/;

async function openTmux(t: PlaceTools & { tmux: string }, req: PlaceRequest): Promise<Placed> {
  const tmux = (...args: string[]) => run([t.tmux, "-u", ...(t.socket ? ["-S", t.socket] : []), ...args]);
  const tail = ["-c", req.folder, "-n", req.name, "-P", "-F", TMUX_FORMAT, "--", ...loginArgv(t.shell, req.argv, req.env)];
  const window = () => tmux("new-window", "-d", "-t", `=${TMUX_SESSION}:`, ...tail);
  let r = await window();
  if (r.status !== 0 && NO_SESSION.test(r.stderr)) r = await tmux("new-session", "-d", "-s", TMUX_SESSION, ...tail);
  if (r.status !== 0 && r.stderr.includes("duplicate session")) r = await window();
  if (r.status !== 0) return { ok: false, why: "failed", detail: `tmux: ${said(r)}` };
  const [socket, session, win, pane, pid] = r.stdout.trim().split("\t");
  if (!socket || !session || !win || !pane) return { ok: false, why: "failed", detail: "tmux opened a window but didn't say which" };
  return { ok: true, place: "tmux", socket, session, window: win, pane, ...(Number(pid) > 0 ? { pid: Number(pid) } : {}) };
}

const DO_SCRIPT = [
  "on run argv",
  'set started to not (application "Terminal" is running)',
  'tell application "Terminal"',
  "if started then",
  "repeat 50 times",
  "if (count of windows) > 0 then exit repeat",
  "delay 0.1",
  "end repeat",
  "if (count of windows) > 0 then return do script (item 1 of argv) in window 1",
  "end if",
  "return do script (item 1 of argv)",
  "end tell",
  "end run",
];

async function openTerminal(t: PlaceTools & { osascript: string }, req: PlaceRequest): Promise<Placed> {
  const r = await run([t.osascript, ...DO_SCRIPT.flatMap((line) => ["-e", line]), terminalLine(t.shell, req)], 120_000);
  if (r.status === 0) {
    const window = Number(/window id (\d+)/.exec(r.stdout)?.[1]);
    return { ok: true, place: "terminal", ...(window > 0 ? { window } : {}) };
  }
  if (r.stderr.includes("-1743")) return { ok: false, why: "not-allowed", detail: "Allow control of Terminal in System Settings → Privacy & Security → Automation" };
  return { ok: false, why: "failed", detail: `Terminal: ${said(r)}` };
}

export async function placeKind(tools?: PlaceTools): Promise<PlaceKind | null> {
  const t = tools ?? (await placeTools());
  if (await rexServer(t)) return "rex";
  if (t.tmux) return "tmux";
  return t.platform === "darwin" && t.osascript ? "terminal" : null;
}

export async function openPlace(req: PlaceRequest, tools?: PlaceTools): Promise<Placed> {
  const bad = badRequest(req);
  if (bad) return { ok: false, why: "bad-request", detail: bad };
  const t = tools ?? (await placeTools());
  const server = await rexServer(t);
  if (server && t.rex) return openRex({ ...t, rex: t.rex }, server, req);
  if (t.tmux) return openTmux({ ...t, tmux: t.tmux }, req);
  if (t.platform === "darwin" && t.osascript) return openTerminal({ ...t, osascript: t.osascript }, req);
  return { ok: false, why: "no-place", detail: "No terminal to open: install tmux, or run kiwi join yourself" };
}
