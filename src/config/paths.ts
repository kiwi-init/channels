import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Signed, SigningBudget } from "@kiwi/core/sas.ts";

export function home(): string {
  if (process.env.KIWI_HOME) {
    tightenHome(process.env.KIWI_HOME);
    return process.env.KIWI_HOME;
  }
  const dir = join(homedir(), ".kiwi");
  if (existsSync(dir)) {
    tightenHome(dir);
    return dir;
  }
  for (const name of [".channel-one", ".modelchannel"]) {
    const old = join(homedir(), name);
    if (!existsSync(old)) continue;
    if (oldClientRunning(old)) {
      tightenHome(old);
      return old;
    }
    renameSync(old, dir);
    tightenHome(dir);
    return dir;
  }
  return dir;
}

const tightened = new Set<string>();

const KIWI_DIRS = ["cache", "cursors", "downloads", "hook-state", "identities", "listeners", "records"] as const;
const KIWI_FILES = ["config.json", "machine.json"] as const;

function isRealDir(p: string): boolean {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isRealFile(p: string): boolean {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
}

export function hasKiwiState(dir: string): boolean {
  return isRealFile(join(dir, "config.json")) || isRealFile(join(dir, "machine.json")) || isRealDir(join(dir, "identities"));
}

function tightenHome(dir: string): void {
  if (tightened.has(dir)) return;
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  tightened.add(dir);
  if (!hasKiwiState(dir)) return;
  try {
    chmodSync(dir, 0o700);
    for (const name of KIWI_DIRS) lockKiwiDir(join(dir, name), name === "downloads");
    for (const name of KIWI_FILES) {
      const p = join(dir, name);
      if (!isRealFile(p)) continue;
      try {
        chmodSync(p, 0o600);
      } catch {
        // A file this user can't chmod keeps its mode; the rest are still tightened.
      }
    }
  } catch {
    // A file this user can't chmod must not stop startup.
  }
}

function lockKiwiDir(dir: string, privateFiles: boolean): void {
  if (!isRealDir(dir)) return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    return;
  }
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let child;
    try {
      child = lstatSync(p);
    } catch {
      continue;
    }
    if (child.isSymbolicLink()) continue;
    if (child.isDirectory()) {
      lockKiwiDir(p, privateFiles);
      continue;
    }
    if (child.isFile() && privateFiles) {
      try {
        chmodSync(p, 0o600);
      } catch {
        // A file this user can't chmod keeps its mode; the rest are still tightened.
      }
    }
  }
}

function oldClientRunning(dir: string): boolean {
  const listeners = join(dir, "listeners");
  if (!existsSync(listeners)) return false;
  return readdirSync(listeners).some((f) => {
    const pid = Number(f.split(".").pop());
    try {
      return pid > 0 && (process.kill(pid, 0), true);
    } catch {
      return false;
    }
  });
}

export const signingBudget: SigningBudget = {
  load(roomId) {
    try {
      const t = JSON.parse(readFileSync(join(home(), "checks", `${safe(roomId)}.json`), "utf8")) as unknown;
      return Array.isArray(t) ? (t as Signed[]) : [];
    } catch {
      return [];
    }
  },
  save(roomId, signed) {
    writePrivate(join(home(), "checks", `${safe(roomId)}.json`), JSON.stringify(signed));
  },
};

export function writePrivate(path: string, data: string | Uint8Array): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const names = [`${path}.${process.pid}.tmp`, `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`];
  let blocked: unknown;
  for (const tmp of names) {
    try {
      writeFileSync(tmp, data, { mode: 0o600, flag: "wx" });
    } catch (err) {
      if (fileExists(err)) {
        blocked = err;
        continue;
      }
      throw err;
    }
    try {
      renameSync(tmp, path);
    } catch (err) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        // The rename's error is the one to throw; a leftover tmp file is only debris.
      }
      throw err;
    }
    try {
      chmodSync(path, 0o600);
    } catch {
      // Written 0600 already; a mode this user can't set must not fail the write.
    }
    return;
  }
  throw blocked;
}

function fileExists(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "EEXIST";
}

export function safe(s: string): string {
  const out = [...s].map((c) => (/[a-z0-9_.-]/.test(c) ? c : `~${c.codePointAt(0)!.toString(16)}~`)).join("");
  if (out === ".") return "~2e~";
  if (out === "..") return "~2e~~2e~";
  return out;
}
