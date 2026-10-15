import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";

const OLD_PACKAGES = new Set(["kiwi", "channel-one", "modelchannel"]);
const OLD_COMMANDS = ["mc", "kiwi", "mc.exe", "kiwi.exe"];
const UPDATE_DIR = /^kiwi-update-/;
const DAY_MS = 86_400_000;

export interface CleanupPlaces {
  home: string;
  bin: string;
  tmp?: string;
  bun?: string;
  path?: string;
  now?: number;
}

export interface Cleaned {
  removed: string[];
  warnings: string[];
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM";
  }
}

function remove(path: string, out: Cleaned): void {
  try {
    rmSync(path, { recursive: true, force: true });
    out.removed.push(path);
  } catch (err) {
    out.warnings.push(`couldn't remove ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function updateDebris(bin: string, out: Cleaned): void {
  for (const f of entries(bin)) if (/^kiwi(\.exe)?\.new-\d+$/.test(f)) remove(join(bin, f), out);
}

function deadListenerFiles(home: string, out: Cleaned): void {
  const listeners = join(home, "listeners");
  for (const f of entries(listeners)) if (!alive(Number(f.slice(f.lastIndexOf(".") + 1)))) remove(join(listeners, f), out);
  const hooks = join(home, "listen-hooks");
  for (const f of entries(hooks)) {
    if (f.endsWith(".delivered")) continue;
    let pid = 0;
    try {
      pid = Number(readFileSync(join(hooks, f), "utf8"));
    } catch {}
    if (!alive(pid)) remove(join(hooks, f), out);
  }
  for (const dir of [listeners, hooks]) {
    if (existsSync(dir) && entries(dir).length === 0) remove(dir, out);
  }
}

function oldUpdates(tmp: string, now: number, out: Cleaned): void {
  for (const f of entries(tmp)) {
    if (!UPDATE_DIR.test(f)) continue;
    const p = join(tmp, f);
    try {
      if (now - statSync(p).mtimeMs > DAY_MS) remove(p, out);
    } catch {}
  }
}

function packageName(dir: string): string | null {
  try {
    const name = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

function bunShims(bun: string, out: Cleaned): void {
  const globals = resolve(bun, "install", "global", "node_modules");
  let real: string;
  try {
    real = realpathSync(globals) + sep;
  } catch {
    return;
  }
  for (const name of OLD_COMMANDS) {
    const shim = join(bun, "bin", name);
    let target: string;
    try {
      if (!lstatSync(shim).isSymbolicLink()) continue;
      target = realpathSync(shim);
    } catch {
      continue;
    }
    if (!target.startsWith(real)) continue;
    const pkg = join(globals, target.slice(real.length).split(sep)[0]!);
    const named = packageName(pkg);
    if (named && OLD_PACKAGES.has(named)) {
      remove(shim, out);
      out.warnings.push(`an old Bun install of kiwi stays in ${pkg}: \`bun remove -g ${named}\` removes it`);
    }
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function shadowing(bin: string, path: string, out: Cleaned): void {
  const ours = resolve(bin);
  for (const dir of path.split(delimiter).filter(Boolean)) {
    if (resolve(dir) === ours) return;
    for (const name of process.platform === "win32" ? ["kiwi.exe", "kiwi.cmd"] : ["kiwi"]) {
      const p = join(dir, name);
      if (existsSync(p) && !sameFile(p, join(ours, name))) out.warnings.push(`${p} comes before ${join(ours, name)} on your PATH, so plain \`kiwi\` runs that one: remove it`);
    }
  }
}

export function cleanup(places: CleanupPlaces): Cleaned {
  const out: Cleaned = { removed: [], warnings: [] };
  updateDebris(places.bin, out);
  deadListenerFiles(places.home, out);
  oldUpdates(places.tmp ?? tmpdir(), places.now ?? Date.now(), out);
  bunShims(places.bun ?? process.env.BUN_INSTALL ?? join(homedir(), ".bun"), out);
  shadowing(places.bin, places.path ?? process.env.PATH ?? "", out);
  return out;
}
