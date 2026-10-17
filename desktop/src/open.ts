import { spawn } from "node:child_process";

const KIWI_ONLY =
  /^(CHROME_DESKTOP|GIO_LAUNCHED_DESKTOP_FILE|GIO_LAUNCHED_DESKTOP_FILE_PID|BAMF_DESKTOP_FILE_HINT|APPDIR|APPIMAGE|ARGV0|OWD|ELECTRON_.+)$/;

export function browserEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !KIWI_ONLY.test(k)) out[k] = v;
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

export function openInBrowser(
  url: string,
  fallback: (url: string) => Promise<void>,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  launch: Launch = spawn,
): Promise<void> {
  if (platform !== "linux") return fallback(url);
  return new Promise((resolve, reject) => {
    const child = launch("xdg-open", [url], {
      env: browserEnv(env),
      detached: true,
      stdio: "ignore",
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", () => fallback(url).then(resolve, reject));
  });
}
