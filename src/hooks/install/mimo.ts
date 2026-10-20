import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { loadConfig } from "../../config.ts";
import { hookCommand, isOurHook, LISTEN } from "../self.ts";

const MARK = "kiwi-mimo-plugin";

export function mimoConfigRoot(env: Record<string, string | undefined> = process.env): string {
  if (env.KIWI_MIMO_DIR) return env.KIWI_MIMO_DIR;
  if (env.MIMOCODE_HOME && isAbsolute(env.MIMOCODE_HOME)) return join(env.MIMOCODE_HOME, "config");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "mimocode");
}

export function mimoPluginPath(env: Record<string, string | undefined> = process.env): string {
  return join(mimoConfigRoot(env), "plugin", "kiwi.ts");
}

export function mimoPluginSource(listen: string): string {
  return `import { spawn, type ChildProcess } from "node:child_process";

type Part = { type: "text"; text: string };
interface Client {
  session: {
    get(options: { path: { id: string } }): Promise<{ data?: { parentID?: string } }>;
    promptAsync(options: { path: { id: string }; body: { parts: Part[] }; throwOnError: true }): Promise<unknown>;
  };
}
interface Kiwi {
  mark: string;
  client: Client | null;
  parents: Map<string, string | null>;
  waiting: Map<string, ChildProcess | null>;
}
type Event = { type: string; properties?: { sessionID?: string; info?: { id?: string; parentID?: string; directory?: string } } };

const MARK = "${MARK}";
const LISTEN = ${JSON.stringify(listen)};
const RETRY_MS = 30_000;
const WAKE_RETRY_FIRST_MS = 1_000;
const holder = globalThis as { __kiwi?: Kiwi };
const kiwi: Kiwi = (holder.__kiwi ??= { mark: MARK, client: null, parents: new Map(), waiting: new Map() });

async function rootOf(id: string): Promise<string> {
  let at = id;
  for (let i = 0; i < 16; i++) {
    if (!kiwi.parents.has(at)) {
      const got = await kiwi.client?.session.get({ path: { id: at } });
      kiwi.parents.set(at, got?.data?.parentID ?? null);
    }
    const up = kiwi.parents.get(at);
    if (!up) return at;
    at = up;
  }
  return at;
}

function knownRoot(id: string): string | null {
  let at = id;
  for (let i = 0; i < 16; i++) {
    if (!kiwi.parents.has(at)) return null;
    const up = kiwi.parents.get(at);
    if (!up) return at;
    at = up;
  }
  return at;
}

function listenOnce(id: string, cwd: string, landed: string | null): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(LISTEN, { shell: true, detached: true, cwd, env: { ...process.env, MIMOCODE_SESSION_ID: id }, stdio: ["pipe", "pipe", "pipe"] });
    kiwi.waiting.set(id, child);
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => void (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => void (err += d.toString()));
    child.on("error", () => resolve({ code: null, out, err }));
    child.on("close", (code: number | null) => resolve({ code, out, err }));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(JSON.stringify({ session_id: id, cwd, hook_event_name: "listen", landed }));
  });
}

async function watch(id: string, cwd: string): Promise<void> {
  if (kiwi.waiting.has(id)) return;
  kiwi.waiting.set(id, null);
  let landed: string | null = null;
  while (kiwi.waiting.has(id)) {
    const ran = await listenOnce(id, cwd, landed);
    landed = null;
    if (!kiwi.waiting.has(id)) return;
    kiwi.waiting.set(id, null);
    const text = ran.code === 2 ? ran.err.trim() : "";
    if (!text) await new Promise((r) => setTimeout(r, RETRY_MS));
    else if (await wake(id, text)) landed = ran.out.trim() || null;
  }
}

function landed(sent: unknown): boolean {
  return !(typeof sent === "object" && sent !== null && "error" in sent && sent.error !== undefined);
}

async function wake(id: string, text: string): Promise<boolean> {
  for (let wait = WAKE_RETRY_FIRST_MS; kiwi.waiting.has(id); wait = Math.min(wait * 2, RETRY_MS)) {
    const prompt = kiwi.client?.session.promptAsync({ path: { id }, body: { parts: [{ type: "text", text }] }, throwOnError: true });
    if (prompt && (await prompt.then(landed, () => false))) return true;
    await new Promise((r) => setTimeout(r, wait));
  }
  return false;
}

function stop(id: string): void {
  const child = kiwi.waiting.get(id);
  kiwi.waiting.delete(id);
  try {
    if (child?.pid) process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }
}

export const KiwiPlugin = async ({ client }: { client: Client }) => {
  kiwi.client = client;
  return {
    "shell.env": async (input: { cwd?: string; sessionID?: string }, output: { env: Record<string, string> }) => {
      if (!input.sessionID) return;
      try {
        const id = await rootOf(input.sessionID);
        output.env.MIMOCODE_SESSION_ID = id;
        if (id !== input.sessionID) stop(input.sessionID);
        void watch(id, input.cwd ?? process.cwd());
      } catch {
        // MiMoCode couldn't name the session's parent: a root another lookup found wins, else the session's own id still reaches its listener.
        const id = knownRoot(input.sessionID) ?? input.sessionID;
        output.env.MIMOCODE_SESSION_ID = id;
        void watch(id, input.cwd ?? process.cwd());
      }
    },
    event: async ({ event }: { event: Event }) => {
      const info = event.properties?.info;
      if (event.type === "session.created" && info?.id) {
        kiwi.parents.set(info.id, info.parentID ?? null);
        if (!info.parentID) void watch(info.id, info.directory ?? process.cwd());
      }
      if (event.type === "session.deleted" && info?.id) stop(info.id);
    },
  };
};
`;
}

function listenIn(text: string): string | null {
  const json = /^const LISTEN = (".*");$/m.exec(text)?.[1];
  if (!json) return null;
  const parsed: unknown = JSON.parse(json);
  return typeof parsed === "string" ? parsed : null;
}

export function installMimo(): string {
  const path = mimoPluginPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, mimoPluginSource(hookCommand(LISTEN)));
  return path;
}

export function uninstallMimo(): string {
  const path = mimoPluginPath();
  try {
    if (readFileSync(path, "utf8").includes(`const MARK = "${MARK}";`)) rmSync(path, { force: true });
  } catch {
    // No plugin file there: nothing of ours to remove.
  }
  return path;
}

export function mimoInstalled(): boolean {
  try {
    const path = mimoPluginPath();
    if (!existsSync(path)) return false;
    const text = readFileSync(path, "utf8");
    const listen = listenIn(text);
    return !!listen && isOurHook(listen, LISTEN) && text === mimoPluginSource(listen);
  } catch {
    // A plugin file we can't read or parse isn't ours: it counts as not installed.
    return false;
  }
}

export function migrateMimo(): string | null {
  if (process.env.KIWI_NO_HOOKS) return null;
  try {
    if (loadConfig().harnessHooks?.mimo === "off") return null;
    const text = readFileSync(mimoPluginPath(), "utf8");
    const listen = listenIn(text);
    if (!text.includes(`const MARK = "${MARK}";`) || !listen || !isOurHook(listen, LISTEN) || text === mimoPluginSource(listen)) return null;
    return installMimo();
  } catch {
    // No plugin file, or one we can't read or parse: there is no plugin of ours to bring up to date.
    return null;
  }
}
