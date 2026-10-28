import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loginPath } from "../launch/shell.ts";
import { run, type Ran } from "../terminals/shared/run.ts";

export const HOSTED_SESSION = "_kiwi";
const PAUSE_AFTER_S = 5;
const MIN_TMUX: readonly [number, number] = [3, 2];
const STATE_FILE = "hosted-tmux.json";
const CONF_FILE = "hosted-tmux.conf";
const REATTACH_MS = 1_000;

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

export type HostedLine = (line: string) => void;

type Client = Bun.Subprocess<"pipe", "pipe", "ignore">;

const uid = (): number => process.getuid?.() ?? 0;

export function hostedSocket(home: string, user = uid()): string {
  return join(`/tmp/kiwi-${user}`, createHash("sha256").update(home).digest("hex").slice(0, 12));
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

export async function findTmux(env: Record<string, string | undefined> = process.env): Promise<HostedTmuxBin | null> {
  const bins = [env.KIWI_TMUX, Bun.which("tmux", { PATH: await loginPath() })].filter((b): b is string => !!b);
  for (const bin of bins) {
    const version = (await run([bin, "-V"])).stdout.trim();
    if (tmuxHosts(version)) return { bin, version };
  }
  return null;
}

export class HostedTmux {
  private client: Client | null = null;
  private readonly lines = new Set<HostedLine>();
  private closing = false;

  constructor(
    readonly home: string,
    private readonly find: () => Promise<HostedTmuxBin | null> = findTmux,
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
    return run([st.bin, "-S", st.socket, ...args], 5_000);
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

  async ensure(): Promise<HostedState> {
    if (process.platform === "win32") throw new Error("hosted agents need tmux, which Windows doesn't have");
    this.closing = false;
    const known = this.state();
    if (known && (await this.alive(known))) {
      await this.attach(known);
      return known;
    }
    const found = await this.find();
    if (!found) throw new Error(`hosted agents need tmux ${MIN_TMUX.join(".")} or newer: install it, or point KIWI_TMUX at one`);
    const st: HostedState = { ...found, socket: hostedSocket(this.home) };
    privateDir(dirname(st.socket));
    const conf = join(this.home, CONF_FILE);
    writeFileSync(conf, HOSTED_CONF, { mode: 0o600 });
    const started = await run([st.bin, "-S", st.socket, "-f", conf, "start-server"], 5_000);
    if (started.status !== 0 || !(await this.alive(st))) throw new Error(`tmux didn't start on ${st.socket}: ${started.stderr.trim() || `exit ${started.status}`}`);
    this.save(st);
    await this.attach(st);
    return st;
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

  private async attach(st: HostedState): Promise<void> {
    if (this.attached()) return;
    if ((await this.tmux(st, ["has-session", "-t", `=${HOSTED_SESSION}`])).status !== 0) {
      const made = await this.tmux(st, ["new-session", "-d", "-s", HOSTED_SESSION, "-n", "hold", "true"]);
      if (made.status !== 0) throw new Error(`tmux on ${st.socket} wouldn't make its ${HOSTED_SESSION} session: ${made.stderr.trim()}`);
    }
    const client: Client = Bun.spawn([st.bin, "-S", st.socket, "-C", "attach-session", "-t", `=${HOSTED_SESSION}`], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
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
    let buf = "";
    for await (const chunk of client.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        for (const fn of this.lines) fn(line);
      }
    }
  }
}
