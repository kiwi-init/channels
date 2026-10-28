import { accessSync, closeSync, constants as fsConstants, existsSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { here, seatsNear, type Here, type NamedHookHarness } from "../seats.ts";
import { binDir } from "@kiwi/core/node/shell-path.ts";
import { VERSION } from "../version.ts";
import { asOption, channelOption } from "@kiwi/core/wake.ts";
import { bindingFor } from "./listeners.ts";

const MARK = "# kiwi";
export const EVENTS = { SessionStart: "session-start", UserPromptSubmit: "prompt", Stop: "stop" } as const;
export const LISTEN = "listen";
export const PERMISSION = "permission";
export const KIMI_STOP = "kimi-stop";
export const LISTEN_SECONDS = 7 * 24 * 3600;

export function stableBin(exe: string): string {
  const m = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/([^/]+)$/.exec(exe);
  if (!m?.[1] || !m[2] || !m[3]) return exe;
  for (const link of [join(m[1], "bin", m[3]), join(m[1], "opt", m[2], "bin", m[3])]) {
    try {
      if (realpathSync(link) === realpathSync(exe)) return link;
    } catch {
      // Not linked there: try the next place, else keep the Cellar path.
    }
  }
  return exe;
}

export function selfArgv(): string[] {
  const compiled = !/\.(ts|js)$/.test(Bun.main);
  return compiled ? [stableBin(process.execPath)] : [Bun.which("bun") ?? process.execPath, Bun.main];
}

export function selfCommand(): string {
  return selfArgv().map(shellQuote).join(" ");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const KIWI_EXE = process.platform === "win32" ? "kiwi.exe" : "kiwi";

function installedBin(): string {
  return join(homedir(), ".kiwi", "bin", KIWI_EXE);
}

export const IDENTITY_ARG = "__kiwi-identity";

function selfFile(): string {
  return /\.(ts|js)$/.test(Bun.main) ? Bun.main : process.execPath;
}

export function selfIdentity(): string | null {
  try {
    const file = realpathSync(selfFile());
    const s = statSync(file);
    return `${VERSION} ${file} ${s.dev}:${s.ino} ${s.size} ${s.mtimeMs}`;
  } catch {
    return null;
  }
}

function selfRunnable(): boolean {
  if (!/\.(ts|js)$/.test(Bun.main)) return runnable(process.execPath);
  try {
    return statSync(Bun.main).isFile() && runnable(Bun.which("bun") ?? process.execPath);
  } catch {
    return false;
  }
}

function installCandidates(): string[] {
  const found = [join(binDir(), KIWI_EXE), join(dirname(process.execPath), KIWI_EXE), Bun.which("kiwi")];
  return [...new Set(found.filter((p): p is string => typeof p === "string" && isAbsolute(p)))];
}

const PROBE_ENV = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "KIWI_HOME", "KIWI_INSTALL", "SystemRoot", "USERPROFILE", "PATHEXT", "COMSPEC"];
export const PROBE_MS = 5_000;
export const PROBE_TTL_MS = 30_000;
const probed = new Map<string, { id: string | null; at: number }>();

function probeIdentity(program: string): string | null {
  const env: Record<string, string> = {};
  for (const k of PROBE_ENV) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  let dir: string | null = null;
  let fd: number | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "kiwi-probe-"));
    const out = join(dir, "identity");
    fd = openSync(out, "w");
    const r = Bun.spawnSync([program, IDENTITY_ARG], { cwd: dir, env, stdin: "ignore", stdout: fd, stderr: "ignore", timeout: PROBE_MS, killSignal: "SIGKILL" });
    return r.exitCode === 0 ? readFileSync(out, "utf8").trim() || null : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
  }
}

function identityOf(program: string): string | null {
  let key: string;
  try {
    const s = statSync(program);
    key = `${program}\u0000${s.dev}:${s.ino}\u0000${s.size}\u0000${s.mtimeMs}`;
  } catch {
    return null;
  }
  const known = probed.get(key);
  if (known && Date.now() - known.at < PROBE_TTL_MS) return known.id;
  const id = probeIdentity(program);
  probed.set(key, { id, at: Date.now() });
  return id;
}

export function isOurHookCommand(command: string): boolean {
  for (const event of [...Object.values(EVENTS), LISTEN, PERMISSION, KIMI_STOP]) {
    const tail = ` hook ${event} ${MARK}`;
    if (command.endsWith(tail) && command.length > tail.length) return true;
  }
  return false;
}

function harnessFlag(harness: NamedHookHarness | undefined): string {
  return harness ? ` --harness ${harness}` : "";
}

export function hookCommand(arg: string, harness?: NamedHookHarness): string {
  return `${selfCommand()}${harnessFlag(harness)} hook ${arg} ${MARK}`;
}

function runnable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isOurHook(command: unknown, arg: string, harness?: NamedHookHarness): boolean {
  if (typeof command !== "string") return false;
  if (command === hookCommand(arg, harness)) return selfRunnable();
  const named = installCandidates().find((p) => command === `${shellQuote(p)}${harnessFlag(harness)} hook ${arg} ${MARK}`);
  if (named === undefined || !runnable(named)) return false;
  const self = selfIdentity();
  return self !== null && identityOf(named) === self;
}

export function mcBin(): string {
  if (Bun.which("kiwi")) return "kiwi";
  const installed = installedBin();
  if (existsSync(installed)) return installed;
  return selfCommand();
}

export function mcFor(alias: string, as: string, dir = process.cwd(), who?: Here): string {
  const b = bindingFor(dir, { ...(who ? { who } : {}), claim: false });
  const mine = b?.alias === alias && b.as === as && (b.session ? b.session === (who ?? here()).session : seatsNear(dir).length === 1);
  return mine ? mcBin() : `${mcBin()} ${channelOption(alias)} ${asOption(as)}`;
}
