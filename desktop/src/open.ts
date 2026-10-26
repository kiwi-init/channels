import { spawn } from "node:child_process";

import type { ExternalUrl } from "./guard.ts";
import { sessionEnv } from "./child-env.ts";

const KIWI_ONLY = /^(CHROME_DESKTOP|GIO_LAUNCHED_DESKTOP_FILE|GIO_LAUNCHED_DESKTOP_FILE_PID|BAMF_DESKTOP_FILE_HINT|APPDIR|APPIMAGE|ARGV0|OWD|ELECTRON_.+)$/;

export function browserEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sessionEnv(env))) if (v !== undefined && !KIWI_ONLY.test(k)) out[k] = v;
  return out;
}

export type Launch = (
  cmd: string,
  args: string[],
  opts: { env: Record<string, string>; detached: boolean; stdio: "ignore" },
) => {
  once(event: "spawn", cb: () => void): unknown;
  once(event: "error", cb: (err: Error) => void): unknown;
  unref(): void;
};

export async function openInBrowser(
  url: ExternalUrl,
  fallback: (url: ExternalUrl) => Promise<void>,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  launch: Launch = spawn,
): Promise<void> {
  if (platform !== "linux") return fallback(url);
  const opener = browserEnv(env);
  if (await spawned(launch, "xdg-open", [url], opener)) return;
  if (await spawned(launch, "gio", ["open", "--", url], opener)) return;
  throw new Error("neither xdg-open nor gio is here to open the link");
}

function spawned(launch: Launch, cmd: string, args: string[], env: Record<string, string>): Promise<boolean> {
  return new Promise((resolve) => {
    const child = launch(cmd, args, { env, detached: true, stdio: "ignore" });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", () => resolve(false));
  });
}
