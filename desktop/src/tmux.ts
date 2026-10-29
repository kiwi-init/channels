import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { OWN_TMUX_DIR } from "@kiwi/core/terminals.ts";
import { childEnv } from "./child-env.ts";

const SAYS = /^tmux (\d+\.\d+[a-z]?)$/;

function tmuxVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ["-V"], { timeout: 5_000, env: childEnv() }, (err, stdout) => resolve(err ? null : (SAYS.exec(stdout.trim())?.[1] ?? null)));
  });
}

export async function keepTmux(bundled: string, home: string): Promise<string | null> {
  const version = await tmuxVersion(bundled);
  if (!version) return null;
  const dest = path.join(home, OWN_TMUX_DIR, `tmux-${version}`);
  if ((await tmuxVersion(dest)) === version) return dest;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.new-${process.pid}-${randomUUID()}`;
  try {
    await fs.promises.copyFile(bundled, tmp);
    await fs.promises.chmod(tmp, 0o755);
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  return dest;
}
