import { spawn } from "node:child_process";

import type { ExternalUrl } from "./guard.ts";
import { sessionEnv } from "./child-env.ts";

const KIWI_ONLY = /^(CHROME_DESKTOP|GIO_LAUNCHED_DESKTOP_FILE|GIO_LAUNCHED_DESKTOP_FILE_PID|BAMF_DESKTOP_FILE_HINT|APPDIR|APPIMAGE|ARGV0|OWD|ELECTRON_.+)$/;

export function browserEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sessionEnv(env))) if (v !== undefined && !KIWI_ONLY.test(k)) out[k] = v;
  return out;
}

interface Opener {
  once(event: "spawn", cb: () => void): unknown;
  once(event: "error", cb: (err: Error) => void): unknown;
  once(event: "exit", cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  stderr: { on(event: "data", cb: (chunk: Buffer | string) => void): unknown; once(event: "close", cb: () => void): unknown; destroy(): void } | null;
  unref(): void;
}

export type Launch = (cmd: string, args: string[], opts: { env: Record<string, string>; detached: boolean; stdio: ["ignore", "ignore", "pipe"] }) => Opener;

const STILL_OPENING_MS = 2_000;

const KFMCLIENT_MISSING = /^.*\bkfmclient: command not found$/m;
const KDE_BRANCH = /^Selected DE kde$/m;
const SAYS_ITS_BRANCH = { XDG_UTILS_DEBUG_LEVEL: "2" };
const STDERR_TAIL = 4_096;
const LATE_STDERR_MS = 250;

interface Heard {
  tail: string;
  kdeBranch: boolean;
  kfmclientMissing: string;
}

function hear(heard: Heard, text: string): void {
  const seen = heard.tail + text;
  heard.kdeBranch ||= KDE_BRANCH.test(seen);
  heard.kfmclientMissing ||= KFMCLIENT_MISSING.exec(seen)?.[0] ?? "";
  heard.tail = seen.slice(-STDERR_TAIL);
}

type Ran = { kind: "opened" } | { kind: "failed"; reason: string } | { kind: "missing" };

export async function openInBrowser(
  url: ExternalUrl,
  fallback: (url: ExternalUrl) => Promise<void>,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  launch: Launch = spawn,
  stillOpeningMs: number = STILL_OPENING_MS,
): Promise<void> {
  if (platform !== "linux") return fallback(url);
  const opener = browserEnv(env);
  const xdg = await run(launch, "xdg-open", [url], { ...opener, ...SAYS_ITS_BRANCH }, stillOpeningMs);
  if (xdg.kind === "opened") return;
  if (xdg.kind === "failed") throw new Error(`xdg-open couldn't open the link: ${xdg.reason}`);
  const gio = await run(launch, "gio", ["open", "--", url], opener, stillOpeningMs);
  if (gio.kind === "opened") return;
  if (gio.kind === "failed") throw new Error(`gio couldn't open the link: ${gio.reason}`);
  throw new Error("neither xdg-open nor gio is here to open the link");
}

const lastLine = (text: string): string => text.trim().split("\n").filter(Boolean).at(-1) ?? "";

function exited(cmd: string, heard: Heard, code: number | null, signal: NodeJS.Signals | null): Ran {
  if (signal) return { kind: "failed", reason: `stopped by ${signal}` };
  const last = lastLine(heard.tail);
  if (code !== 0) return { kind: "failed", reason: `exit ${code}${last ? `: ${last}` : ""}` };
  return cmd === "xdg-open" && heard.kdeBranch && heard.kfmclientMissing
    ? { kind: "failed", reason: `exit 0, but kfmclient, its only way to open a link in this KDE session, isn't installed: ${heard.kfmclientMissing}` }
    : { kind: "opened" };
}

function run(launch: Launch, cmd: string, args: string[], env: Record<string, string>, stillOpeningMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = launch(cmd, args, { env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
    const heard: Heard = { tail: "", kdeBranch: false, kfmclientMissing: "" };
    let stderrClosed = !child.stderr;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (ran: Ran) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stderr?.destroy();
      resolve(ran);
    };
    child.stderr?.on("data", (chunk) => hear(heard, chunk.toString()));
    child.stderr?.once("close", () => void (stderrClosed = true));
    child.once("error", () => settle({ kind: "missing" }));
    child.once("spawn", () => {
      child.unref();
      timer = setTimeout(() => settle({ kind: "opened" }), stillOpeningMs);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const verdict = () => settle(exited(cmd, heard, code, signal));
      if (stderrClosed) return verdict();
      child.stderr?.once("close", verdict);
      timer = setTimeout(verdict, LATE_STDERR_MS);
    });
  });
}
