import { spawn } from "node:child_process";

import type { ExternalUrl } from "./guard.ts";
import { sessionEnv } from "./child-env.ts";

const KIWI_ONLY = /^(CHROME_DESKTOP|GIO_LAUNCHED_DESKTOP_FILE|GIO_LAUNCHED_DESKTOP_FILE_PID|BAMF_DESKTOP_FILE_HINT|APPDIR|APPIMAGE|ARGV0|OWD|ELECTRON_.+)$/;

export function browserEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sessionEnv(env))) if (v !== undefined && !KIWI_ONLY.test(k)) out[k] = v;
  return out;
}

export interface Opener {
  once(event: "spawn", cb: () => void): unknown;
  once(event: "error", cb: (err: Error) => void): unknown;
  once(event: "exit", cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  stderr: { on(event: "data", cb: (chunk: Buffer | string) => void): unknown; destroy(): void } | null;
  unref(): void;
}

export type Launch = (cmd: string, args: string[], opts: { env: Record<string, string>; detached: boolean; stdio: ["ignore", "ignore", "pipe"] }) => Opener;

export const STILL_OPENING_MS = 2_000;

const KFMCLIENT_MISSING = /\bkfmclient: command not found/;
const KDE_BRANCH = /^Selected DE kde$/m;
const SAYS_ITS_BRANCH = { XDG_UTILS_DEBUG_LEVEL: "2" };
const STDERR_KEEP = 4_096;

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

function exited(cmd: string, said: string, code: number | null, signal: NodeJS.Signals | null): Ran {
  if (signal) return { kind: "failed", reason: `stopped by ${signal}` };
  if (code !== 0) return { kind: "failed", reason: `exit ${code}${lastLine(said) ? `: ${lastLine(said)}` : ""}` };
  const missing = cmd === "xdg-open" && KDE_BRANCH.test(said) ? KFMCLIENT_MISSING.exec(said) : null;
  return missing
    ? { kind: "failed", reason: `exit 0, but kfmclient, its only way to open a link in this KDE session, isn't installed: ${lastLine(said.slice(0, missing.index + missing[0].length))}` }
    : { kind: "opened" };
}

function run(launch: Launch, cmd: string, args: string[], env: Record<string, string>, stillOpeningMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = launch(cmd, args, { env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
    let said = "";
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (ran: Ran) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ran);
    };
    child.stderr?.on("data", (chunk) => {
      if (said.length < STDERR_KEEP) said += chunk.toString();
    });
    child.once("error", () => settle({ kind: "missing" }));
    child.once("spawn", () => {
      child.unref();
      timer = setTimeout(() => {
        child.stderr?.destroy();
        settle({ kind: "opened" });
      }, stillOpeningMs);
    });
    child.once("exit", (code, signal) => settle(exited(cmd, said, code, signal)));
  });
}
