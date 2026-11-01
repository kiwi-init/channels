import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loginPath, loginShell } from "../launch/shell.ts";
import { OWN_TMUX_DIR } from "@kiwi/core/terminals.ts";
import type { Ended } from "../launch/place.ts";
import type { Pane, PlaceRequest, Placed } from "../terminals/plugin.ts";
import { loginArgv, SESSION_MARKERS } from "../terminals/shared/launch.ts";
import { run, said, type Ran } from "../terminals/shared/run.ts";
import { hostedDir } from "../terminals/shared/tmux.ts";
import { tmuxPane } from "../terminals/tmux/type.ts";
import { controlOutput, keyCommands } from "./hosted-term.ts";

export const HOSTED_SESSION = "_kiwi";
const PAUSE_AFTER_S = 5;
const MIN_TMUX: readonly [number, number] = [3, 2];
const STATE_FILE = "hosted-tmux.json";
const OWN_TMUX = /^tmux-(\d+)\.(\d+)([a-z]?)$/;
const CONF_FILE = "hosted-tmux.conf";
const REATTACH_MS = 1_000;
const WINDOW_FORMAT = "#{window_id}\t#{pane_id}\t#{pane_pid}";
const TYPED_HOLD_MS = 3_000;
const NEWLINE = 0x0a;
const PAUSED = /^%pause (%\d+)$/;
const GONE = /^%(?:window-close|unlinked-window-close) (@\d+)$/;
const MINE = "@kiwi-mine";
const MINE_FORMAT = `#{${MINE}}\t#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_current_command}`;
const DEAD_LINE = /^Pane is dead\b/;
const TAIL_LINES = 6;
const DEAD_NO_STATUS_MS = 1_500;
const TAIL_WIDTH = 200;

export const HOSTED_CONF = [
  "set -s exit-empty off",
  "set -s escape-time 0",
  "set -s focus-events on",
  "set -g default-terminal screen-256color",
  "set -g remain-on-exit on",
  "set-hook -g after-new-session 'set -w window-size manual'",
  "set-hook -g after-new-window 'set -w window-size manual'",
  "",
].join("\n");

export interface HostedTmuxBin {
  bin: string;
  version: string;
}

export interface HostedState extends HostedTmuxBin {
  socket: string;
}

export interface MineTab {
  pane: string;
  label: string;
}

export type HostedLine = (line: string) => void;

export type HostedOutput = (data: Uint8Array) => void;

type Client = Bun.Subprocess<"pipe", "pipe", "ignore">;

const uid = (): number => process.getuid?.() ?? 0;

export function hostedSocket(home: string, user = uid()): string {
  return join(hostedDir(user), createHash("sha256").update(home).digest("hex").slice(0, 12));
}

export function tmuxHosts(version: string): boolean {
  const m = /(\d+)\.(\d+)/.exec(version);
  if (!m) return /\bmaster\b/.test(version);
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > MIN_TMUX[0] || (major === MIN_TMUX[0] && minor >= MIN_TMUX[1]);
}

export function privateDir(path: string, user = uid()): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const st = lstatSync(path);
  if (!st.isDirectory() || st.uid !== user) throw new Error(`${path} isn't this user's own folder, so hosted agents can't keep their tmux socket there`);
  if ((st.mode & 0o077) !== 0) chmodSync(path, 0o700);
}

export function ownTmux(home: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(home, OWN_TMUX_DIR));
  } catch {
    // No app has put its tmux in this home.
    return [];
  }
  const rank = (name: string): [number, number, string] => {
    const m = OWN_TMUX.exec(name);
    return m ? [Number(m[1]), Number(m[2]), m[3] ?? ""] : [-1, -1, ""];
  };
  return names
    .filter((name) => OWN_TMUX.test(name))
    .sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return y[0] - x[0] || y[1] - x[1] || y[2].localeCompare(x[2]);
    })
    .map((name) => join(home, OWN_TMUX_DIR, name));
}

function lastLines(screen: string, most = TAIL_LINES): string[] {
  return screen
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l && !DEAD_LINE.test(l))
    .slice(-most)
    .map((l) => (l.length > TAIL_WIDTH ? `${l.slice(0, TAIL_WIDTH - 1)}…` : l));
}

const CD_SHELL = existsSync("/bin/zsh") ? ["/bin/zsh", "-f"] : ["/bin/sh"];

export function inFolder(folder: string, argv: readonly string[], sh: readonly string[] = CD_SHELL): string[] {
  return [...sh, "-c", 'cd -- "$1" 2>/dev/null || cd; shift; exec "$@"', "kiwi-cd", folder, ...argv];
}

export async function findTmux(home: string, env: Record<string, string | undefined> = process.env): Promise<HostedTmuxBin | null> {
  const bins = [env.KIWI_TMUX, ...ownTmux(home), Bun.which("tmux", { PATH: await loginPath() })].filter((b): b is string => !!b);
  for (const bin of bins) {
    const version = (await run([bin, "-V"])).stdout.trim();
    if (tmuxHosts(version)) return { bin, version };
  }
  return null;
}

export class HostedTmux {
  private client: Client | null = null;
  private readonly lines = new Set<HostedLine>();
  private readonly outputs = new Map<string, Set<HostedOutput>>();
  private readonly typed = new Map<string, number>();
  private readonly deadSeen = new Map<string, number>();
  private closing = false;
  private ensuring: Promise<HostedState> | null = null;
  private attaching: Promise<void> | null = null;

  constructor(
    readonly home: string,
    private readonly find: (home: string) => Promise<HostedTmuxBin | null> = findTmux,
  ) {}

  state(): HostedState | null {
    try {
      const s = JSON.parse(readFileSync(join(this.home, STATE_FILE), "utf8")) as Partial<HostedState>;
      return typeof s.bin === "string" && typeof s.version === "string" && typeof s.socket === "string" ? { bin: s.bin, version: s.version, socket: s.socket } : null;
    } catch {
      // No server started from this home yet, or a state file nobody can trust: start afresh.
      return null;
    }
  }

  tmux(st: HostedState, args: readonly string[]): Promise<Ran> {
    return run([st.bin, "-u", "-S", st.socket, ...args], 5_000, homedir());
  }

  async alive(st: HostedState): Promise<boolean> {
    return (await this.tmux(st, ["display-message", "-p", "#{pid}"])).status === 0;
  }

  attached(): boolean {
    return !!this.client && this.client.exitCode === null && this.client.signalCode === null;
  }

  async resume(): Promise<HostedState | null> {
    if (process.platform === "win32") return null;
    const st = this.state();
    if (!st || !(await this.alive(st))) return null;
    await this.attach(st);
    return st;
  }

  ensure(): Promise<HostedState> {
    this.ensuring ??= this.ensureOnce().finally(() => (this.ensuring = null));
    return this.ensuring;
  }

  private async ensureOnce(): Promise<HostedState> {
    if (process.platform === "win32") throw new Error("hosted agents need tmux, which Windows doesn't have");
    this.closing = false;
    const known = this.state();
    if (known && (await this.alive(known))) {
      await this.attach(known);
      return known;
    }
    const found = await this.find(this.home);
    if (!found) throw new Error(`hosted agents need tmux ${MIN_TMUX.join(".")} or newer: install it, or point KIWI_TMUX at one`);
    const st: HostedState = { ...found, socket: hostedSocket(this.home) };
    privateDir(dirname(st.socket));
    const conf = join(this.home, CONF_FILE);
    writeFileSync(conf, HOSTED_CONF, { mode: 0o600 });
    const started = await run([st.bin, "-u", "-S", st.socket, "-f", conf, "start-server"], 5_000, homedir());
    if (started.status !== 0 || !(await this.alive(st))) throw new Error(`tmux didn't start on ${st.socket}: ${started.stderr.trim() || `exit ${started.status}`}`);
    this.save(st);
    await this.attach(st);
    return st;
  }

  async ready(): Promise<string | null> {
    try {
      await this.ensure();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  async open(req: PlaceRequest): Promise<Placed> {
    const why = await this.ready();
    const st = this.state();
    if (why || !st) return { ok: false, why: "no-place", detail: why ?? "the hosted tmux server didn't start" };
    const argv = inFolder(req.folder, loginArgv(loginShell(), req.argv, { ...req.env, KIWI_TMUX: st.bin }));
    const r = await this.tmux(st, ["new-window", "-d", "-t", `=${HOSTED_SESSION}:`, "-c", req.folder, "-n", req.name, "-P", "-F", WINDOW_FORMAT, "--", ...argv]);
    if (r.status !== 0) return { ok: false, why: "failed", detail: `tmux: ${said(r)}` };
    const [window, pane, pid] = r.stdout.trim().split("\t");
    if (!window || !pane) return { ok: false, why: "failed", detail: "tmux opened a window but didn't say which" };
    return { ok: true, place: "hosted", socket: st.socket, window, pane, ...(Number(pid) > 0 ? { pid: Number(pid) } : {}) };
  }

  async mineTabs(): Promise<MineTab[]> {
    const st = this.state();
    if (!st) return [];
    const listed = await this.tmux(st, ["list-windows", "-t", `=${HOSTED_SESSION}`, "-F", MINE_FORMAT]);
    const tabs: MineTab[] = [];
    for (const line of listed.status === 0 ? listed.stdout.split("\n") : []) {
      const [mark, window, pane, dead, command] = line.split("\t");
      if (mark !== "1" || !window || !pane) continue;
      if (dead === "1") await this.tmux(st, ["kill-window", "-t", window]);
      else tabs.push({ pane, label: command || "shell" });
    }
    return tabs;
  }

  async mine(folder: string, want: string | null = null, shell = loginShell()): Promise<{ ok: true; pane: string } | { ok: false; detail: string }> {
    const why = await this.ready();
    const st = this.state();
    if (why || !st) return { ok: false, detail: why ?? "the hosted tmux server didn't start" };
    const tabs = await this.mineTabs();
    const found = want === "new" ? undefined : (tabs.find((t) => t.pane === want) ?? tabs[0]);
    if (found) return { ok: true, pane: found.pane };
    const argv = inFolder(folder, ["/usr/bin/env", ...SESSION_MARKERS.flatMap((key) => ["-u", key]), shell, "-l"]);
    const r = await this.tmux(st, ["new-window", "-d", "-t", `=${HOSTED_SESSION}:`, "-c", folder, "-n", "you", "-P", "-F", WINDOW_FORMAT, "--", ...argv]);
    const [window, pane] = r.stdout.trim().split("\t");
    if (r.status !== 0 || !window || !pane) return { ok: false, detail: `tmux: ${said(r)}` };
    await this.tmux(st, ["set-option", "-w", "-t", window, MINE, "1"]);
    return { ok: true, pane };
  }

  async closeMine(pane: string): Promise<MineTab[]> {
    const st = this.state();
    if (st && (await this.mineTabs()).some((t) => t.pane === pane)) await this.tmux(st, ["kill-window", "-t", pane]);
    return this.mineTabs();
  }

  pane(pane: string): Pane | null {
    const st = this.state();
    if (!st) return null;
    const inner = tmuxPane({ socket: st.socket, pane }, st.bin);
    const free = (): boolean => !this.typing(pane);
    return {
      screen: inner.screen,
      type: (text) => free() && inner.type(text),
      enter: () => free() && inner.enter(),
      erase: (count) => free() && inner.erase(count),
    };
  }

  async ended(pane: string): Promise<Ended | null> {
    const st = this.state();
    if (!st) return null;
    const r = await this.tmux(st, ["display-message", "-p", "-t", pane, "#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}"]);
    const [dead, status, signal] = r.stdout.replace(/\n$/, "").split("\t");
    const code = /^\d+$/.test(status ?? "") ? Number(status) : /^\d+$/.test(signal ?? "") ? 128 + Number(signal) : null;
    if (r.status !== 0 || dead !== "1") return null;
    if (code === null) {
      const first = this.deadSeen.get(pane) ?? Date.now();
      this.deadSeen.set(pane, first);
      if (Date.now() - first < DEAD_NO_STATUS_MS) return null;
    }
    this.deadSeen.delete(pane);
    const shown = await this.tmux(st, ["capture-pane", "-p", "-J", "-S", "-", "-t", pane]);
    return { code, tail: lastLines(shown.status === 0 ? shown.stdout : "") };
  }

  typing(pane: string): boolean {
    return Date.now() - (this.typed.get(pane) ?? 0) < TYPED_HOLD_MS;
  }

  output(pane: string, fn: HostedOutput): () => void {
    const set = this.outputs.get(pane) ?? new Set<HostedOutput>();
    set.add(fn);
    this.outputs.set(pane, set);
    return () => {
      set.delete(fn);
      if (!set.size) this.outputs.delete(pane);
    };
  }

  gone(pane: string, fn: () => void): () => void {
    let window: string | null = null;
    const st = this.state();
    if (st) void this.tmux(st, ["display-message", "-p", "-t", pane, "#{window_id}"]).then((r) => (window = r.status === 0 ? r.stdout.trim() : null));
    return this.on((line) => {
      const m = GONE.exec(line);
      if (m && m[1] === window) fn();
    });
  }

  keys(pane: string, text: string): boolean {
    this.typed.set(pane, Date.now());
    return keyCommands(pane, text).every((cmd) => this.send(cmd));
  }

  resize(pane: string, cols: number, rows: number): boolean {
    return this.send(`resize-window -t ${pane} -x ${cols} -y ${rows}`);
  }

  on(line: HostedLine): () => void {
    this.lines.add(line);
    return () => this.lines.delete(line);
  }

  send(command: string): boolean {
    if (!this.client || !this.attached()) return false;
    this.client.stdin.write(`${command}\n`);
    this.client.stdin.flush();
    return true;
  }

  async detach(): Promise<void> {
    this.closing = true;
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      client.stdin.end();
    } catch {
      // The client already went away with its pipe.
    }
    const quit = await Promise.race([client.exited.then(() => true), Bun.sleep(2_000).then(() => false)]);
    if (!quit) client.kill();
  }

  async kill(): Promise<void> {
    const st = this.state();
    await this.detach();
    if (st) {
      await this.tmux(st, ["kill-server"]);
      rmSync(st.socket, { force: true });
    }
    rmSync(join(this.home, STATE_FILE), { force: true });
  }

  private save(st: HostedState): void {
    const path = join(this.home, STATE_FILE);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(st)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  }

  private attach(st: HostedState): Promise<void> {
    if (this.attached()) return Promise.resolve();
    this.attaching ??= this.attachOnce(st).finally(() => (this.attaching = null));
    return this.attaching;
  }

  private async attachOnce(st: HostedState): Promise<void> {
    const has = async () => (await this.tmux(st, ["has-session", "-t", `=${HOSTED_SESSION}`])).status === 0;
    if (!(await has())) {
      const made = await this.tmux(st, ["new-session", "-d", "-s", HOSTED_SESSION, "-n", "hold", "true"]);
      if (made.status !== 0 && !(await has())) throw new Error(`tmux on ${st.socket} wouldn't make its ${HOSTED_SESSION} session: ${made.stderr.trim()}`);
    }
    const client: Client = Bun.spawn([st.bin, "-u", "-S", st.socket, "-C", "attach-session", "-t", `=${HOSTED_SESSION}`], { cwd: homedir(), stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    this.client = client;
    this.closing = false;
    client.stdin.write(`refresh-client -f pause-after=${PAUSE_AFTER_S}\n`);
    client.stdin.flush();
    void this.read(client);
    void client.exited.then(() => {
      if (this.client !== client) return;
      this.client = null;
      if (!this.closing) setTimeout(() => void this.resume().catch(() => {}), REATTACH_MS);
    });
  }

  private async read(client: Client): Promise<void> {
    const decoder = new TextDecoder();
    let buf = new Uint8Array(0);
    for await (const chunk of client.stdout) {
      const next = new Uint8Array(buf.length + chunk.length);
      next.set(buf);
      next.set(chunk, buf.length);
      let from = 0;
      for (let nl = next.indexOf(NEWLINE); nl >= 0; nl = next.indexOf(NEWLINE, from)) {
        this.line(next.subarray(from, nl), decoder);
        from = nl + 1;
      }
      buf = next.slice(from);
    }
  }

  private line(bytes: Uint8Array, decoder: TextDecoder): void {
    const out = controlOutput(bytes);
    if (out) {
      for (const fn of this.outputs.get(out.pane) ?? []) fn(out.data);
      return;
    }
    const line = decoder.decode(bytes);
    const paused = PAUSED.exec(line);
    if (paused) this.send(`refresh-client -A '${paused[1]}:continue'`);
    for (const fn of this.lines) fn(line);
  }
}
