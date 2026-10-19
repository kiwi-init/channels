import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRecord } from "../files.ts";
import { hookCommand, isOurHook, LISTEN } from "../self.ts";

export function piRoot(env: Record<string, string | undefined> = process.env): string {
  return env.KIWI_PI_DIR || env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function piExtensionPath(env: Record<string, string | undefined> = process.env): string {
  return join(piRoot(env), "extensions", "kiwi.ts");
}

type PiHook = "session-start" | "prompt" | "stop" | "listen";

const PI_HOOKS: readonly PiHook[] = ["session-start", "prompt", "stop", LISTEN];

export function piExtensionSource(commands: Record<PiHook, string>): string {
  return `import { spawn } from "node:child_process";

type Hook = "session-start" | "prompt" | "stop" | "listen";
type Ran = { code: number | null; out: string; err: string };
type Note = { customType: string; content: string; display: boolean };
interface Context {
  cwd: string;
  sessionManager: { getSessionId(): string };
}
interface Pi {
  on(event: string, handler: (event: unknown, ctx: Context) => unknown): void;
  sendMessage(message: Note, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
}

const HOOKS: Record<Hook, string> = ${JSON.stringify(commands, null, 2)};
const RETRY_MS = 30_000;

function run(hook: Hook, ctx: Context, extra: Record<string, string> = {}, started?: (stop: () => void) => void): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(HOOKS[hook], { shell: true, detached: true, cwd: ctx.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => void (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => void (err += d.toString()));
    child.on("error", () => resolve({ code: null, out, err }));
    child.on("close", (code: number | null) => resolve({ code, out, err }));
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify({ session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, hook_event_name: hook, ...extra }));
    started?.(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone: nothing left to stop.
      }
    });
  });
}

function field(v: unknown, ...path: string[]): string | null {
  let at: unknown = v;
  for (const k of path) at = typeof at === "object" && at !== null ? (at as Record<string, unknown>)[k] : undefined;
  return typeof at === "string" && at.trim() ? at : null;
}

function said(out: string): string | null {
  const text = out.trim();
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return field(v, "reason") ?? field(v, "hookSpecificOutput", "additionalContext") ?? field(v, "additional_context");
  } catch {
    return text;
  }
}

function note(content: string): Note {
  return { customType: "kiwi", content, display: true };
}

export default function kiwi(pi: Pi): void {
  let live = false;
  let stopListener: (() => void) | null = null;

  const listen = async (ctx: Context): Promise<void> => {
    while (live) {
      const ran = await run("listen", ctx, {}, (stop) => void (stopListener = stop));
      stopListener = null;
      if (!live) return;
      const text = ran.code === 2 ? ran.err.trim() : "";
      if (text) pi.sendMessage(note(text), { triggerTurn: true, deliverAs: "followUp" });
      else await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  };

  pi.on("session_start", async (event, ctx) => {
    process.env.KIWI_PI_PID = String(process.pid);
    process.env.KIWI_PI_SESSION = ctx.sessionManager.getSessionId();
    const reason = field(event, "reason");
    const brief = said((await run("session-start", ctx, { source: reason === "startup" || reason === "new" ? "startup" : "resume" })).out);
    if (brief) pi.sendMessage(note(brief), { deliverAs: "nextTurn" });
    live = true;
    void listen(ctx);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const unread = said((await run("prompt", ctx)).out);
    return unread ? { message: note(unread) } : undefined;
  });

  pi.on("agent_end", async (_event, ctx) => {
    const unread = said((await run("stop", ctx)).out);
    if (unread) pi.sendMessage(note(unread), { triggerTurn: true, deliverAs: "followUp" });
  });

  pi.on("session_shutdown", () => {
    live = false;
    stopListener?.();
  });
}
`;
}

export function installPi(): string {
  const path = piExtensionPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, piExtensionSource({ "session-start": hookCommand("session-start"), prompt: hookCommand("prompt"), stop: hookCommand("stop"), listen: hookCommand(LISTEN) }));
  return path;
}

export function uninstallPi(): string {
  const path = piExtensionPath();
  if (piExtensionOurs(path)) rmSync(path, { force: true });
  return path;
}

function piExtensionOurs(path: string): boolean {
  try {
    return readFileSync(path, "utf8").includes('customType: "kiwi"');
  } catch {
    return false;
  }
}

function commandsIn(text: string): Record<PiHook, string> | null {
  const json = /^const HOOKS: Record<Hook, string> = (\{[^}]*\});$/m.exec(text)?.[1];
  const parsed: unknown = json ? JSON.parse(json) : null;
  if (!isRecord(parsed)) return null;
  const { "session-start": start, prompt, stop, listen } = parsed;
  return typeof start === "string" && typeof prompt === "string" && typeof stop === "string" && typeof listen === "string" ? { "session-start": start, prompt, stop, listen } : null;
}

export function piInstalled(): boolean {
  try {
    const path = piExtensionPath();
    if (!existsSync(path)) return false;
    const text = readFileSync(path, "utf8");
    const commands = commandsIn(text);
    return !!commands && text === piExtensionSource(commands) && PI_HOOKS.every((hook) => isOurHook(commands[hook], hook));
  } catch {
    return false;
  }
}
