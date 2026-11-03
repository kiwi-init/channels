import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

const MARK = "__kiwi_login_path__";
const READ_MS = 5_000;

let reading: Promise<string | null> | null = null;

export function passwdShell(platform: NodeJS.Platform, entry: string): string | null {
  const shell = platform === "darwin" ? /^UserShell:\s*(\S+)/m.exec(entry)?.[1] : entry.trim().split(":")[6];
  return shell && isAbsolute(shell) ? shell : null;
}

function accountShell(env: Record<string, string | undefined>): string | null {
  const ask = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2_000 });
  try {
    const user = env.USER || env.LOGNAME || ask("/usr/bin/id", ["-un"]).trim();
    return passwdShell(process.platform, process.platform === "darwin" ? ask("/usr/bin/dscl", [".", "-read", `/Users/${user}`, "UserShell"]) : ask("/usr/bin/getent", ["passwd", user]));
  } catch {
    // No directory service, or no entry for this user: the platform's default shell then.
    return null;
  }
}

export function loginShell(env: Record<string, string | undefined> = process.env): string {
  const said = env.SHELL?.trim();
  if (said && isAbsolute(said)) return said;
  return accountShell(env) ?? (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
}

export function pathAfterMark(out: string): string | null {
  const lines = out.split("\n").map((l) => l.replace(/\r$/, ""));
  const at = lines.lastIndexOf(MARK);
  if (at < 0 || at + 1 >= lines.length - 1) return null;
  return lines[at + 1]?.trim() || null;
}

export function readLoginPath(shell: string, env: Record<string, string | undefined> = process.env, ms = READ_MS): Promise<string | null> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const child = spawn(shell, ["-ilc", `echo ${MARK}; printenv PATH`], { env: { ...env, TERM: "dumb" }, stdio: ["ignore", "pipe", "ignore"], detached: true });
    const finish = (path: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.unref();
      resolve(path);
    };
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // The shell and its group are already gone.
      }
      finish(null);
    }, ms);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const path = pathAfterMark(out);
      if (path) finish(path);
    });
    child.on("error", () => finish(null));
    child.on("close", () => finish(pathAfterMark(out)));
  });
}

function fallbackPath(env: Record<string, string | undefined> = process.env): string {
  const user = env.HOME || homedir();
  return [env.PATH ?? "", join(user, ".local", "bin"), join(user, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(delimiter);
}

export async function loginPath(): Promise<string> {
  if (process.platform === "win32") return process.env.PATH ?? "";
  reading ??= readLoginPath(loginShell()).then((path) => {
    if (!path) reading = null;
    return path;
  });
  return (await reading) ?? fallbackPath();
}
