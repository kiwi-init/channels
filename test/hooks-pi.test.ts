import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoInstallExtraHooks, extraInstalled, hooksStatus, installExtra, uninstallExtra } from "../src/hooks.ts";
import { piExtensionPath, piExtensionSource } from "../src/hooks/install/pi.ts";

const made: string[] = [];
const home = process.env.KIWI_HOME;

function scratch(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}

afterEach(() => {
  if (home === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = home;
  for (const d of made) rmSync(d, { recursive: true, force: true });
  made.length = 0;
});

type Note = { customType: string; content: string; display: boolean };
type Sent = { message: Note; options?: { triggerTurn?: boolean; deliverAs?: string } };
type Context = { cwd: string; sessionManager: { getSessionId(): string } };
type Handler = (event: unknown, ctx: Context) => unknown;

async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("Pi: the extension is written into Pi's extensions folder, counted as installed, and removed on uninstall", () => {
  const path = installExtra("pi");
  expect(path).toBe(join(process.env.KIWI_PI_DIR!, "extensions", "kiwi.ts"));
  expect(path).toBe(piExtensionPath());
  const text = readFileSync(path, "utf8");
  expect(text).toContain(" hook listen # kiwi");
  expect(text).toContain(" hook stop # kiwi");
  expect(extraInstalled("pi")).toBe(true);
  expect(hooksStatus()).toContain("pi: installed");

  writeFileSync(path, text.replace("const RETRY_MS = 30_000;", "const RETRY_MS = 1;"));
  expect(extraInstalled("pi")).toBe(false);

  uninstallExtra("pi");
  expect(existsSync(path)).toBe(false);
  expect(extraInstalled("pi")).toBe(false);
});

test("Pi: joining from inside Pi installs its extension once, and from elsewhere doesn't", () => {
  process.env.KIWI_HOME = scratch("kiwi-pi-home-");
  expect(autoInstallExtraHooks()).toBeNull();
  process.env.PI_CODING_AGENT = "true";
  expect(autoInstallExtraHooks()).toBe(`Pi hooks (${piExtensionPath()})`);
  expect(autoInstallExtraHooks()).toBeNull();
  expect(extraInstalled("pi")).toBe(true);
  uninstallExtra("pi");
});

test("Pi: uninstall leaves an extension of the same name that isn't Kiwi's", () => {
  const path = piExtensionPath();
  installExtra("pi");
  writeFileSync(path, "export default function mine(): void {}\n");
  uninstallExtra("pi");
  expect(readFileSync(path, "utf8")).toBe("export default function mine(): void {}\n");
});

test("Pi: the extension exports its session, briefs it, adds unread messages to a prompt, hands them over at a turn's end, and is woken by the listener", async () => {
  const dir = scratch("kiwi-pi-ext-");
  const stdin = join(dir, "listen-stdin.json");
  const runs = join(dir, "listen-runs");
  const pidFile = join(dir, "listen-pid");
  const listen = join(dir, "listen.sh");
  writeFileSync(
    listen,
    [
      `echo run >> ${runs}`,
      `if [ "$(wc -l < ${runs})" -eq 1 ]; then cat > ${stdin}; echo "New Kiwi Channels messages for you (test): #4 hi" >&2; exit 2; fi`,
      `echo $$ > ${pidFile}`,
      "exec sleep 60",
    ].join("\n"),
  );
  const file = join(dir, "kiwi.ts");
  writeFileSync(
    file,
    piExtensionSource({
      "session-start": `cat > ${join(dir, "start-stdin.json")}; printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"the brief"}}'`,
      prompt: `echo "unread: #3 $KIWI_PI_SESSION"`,
      stop: `printf '%s' '{"decision":"block","reason":"handle #5 first"}'`,
      listen: `sh ${listen}`,
    }),
  );
  const mod = (await import(file)) as { default: (pi: unknown) => void };
  const handlers = new Map<string, Handler>();
  const sent: Sent[] = [];
  mod.default({
    on: (event: string, handler: Handler) => void handlers.set(event, handler),
    sendMessage: (message: Note, options?: Sent["options"]) => void sent.push({ message, ...(options ? { options } : {}) }),
  });
  const ctx: Context = { cwd: dir, sessionManager: { getSessionId: () => "pi-session-1" } };
  try {
    await handlers.get("session_start")!({ reason: "startup" }, ctx);
    expect(process.env.KIWI_PI_PID).toBe(String(process.pid));
    expect(process.env.KIWI_PI_SESSION).toBe("pi-session-1");
    expect(sent[0]).toEqual({ message: { customType: "kiwi", content: "the brief", display: true }, options: { deliverAs: "nextTurn" } });
    expect(JSON.parse(readFileSync(join(dir, "start-stdin.json"), "utf8"))).toEqual({ session_id: "pi-session-1", cwd: dir, hook_event_name: "session-start", source: "startup" });

    await until("the listener's wake", () => sent.length === 2);
    expect(sent[1]).toEqual({ message: { customType: "kiwi", content: "New Kiwi Channels messages for you (test): #4 hi", display: true }, options: { triggerTurn: true, deliverAs: "followUp" } });
    expect(JSON.parse(readFileSync(stdin, "utf8"))).toEqual({ session_id: "pi-session-1", cwd: dir, hook_event_name: "listen" });

    expect(await handlers.get("before_agent_start")!({ prompt: "go" }, ctx)).toEqual({ message: { customType: "kiwi", content: "unread: #3 pi-session-1", display: true } });

    await handlers.get("agent_end")!({ messages: [] }, ctx);
    expect(sent[2]).toEqual({ message: { customType: "kiwi", content: "handle #5 first", display: true }, options: { triggerTurn: true, deliverAs: "followUp" } });

    await until("the listener to run again", () => existsSync(pidFile));
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(alive(pid)).toBe(true);
    await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
    await until("the listener to stop", () => !alive(pid));
    expect(sent).toHaveLength(3);
  } finally {
    await handlers.get("session_shutdown")?.({ reason: "quit" }, ctx);
  }
});

test("Pi: a hook with nothing to say adds nothing", async () => {
  const dir = scratch("kiwi-pi-quiet-");
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, piExtensionSource({ "session-start": "true", prompt: "true", stop: "true", listen: "sleep 60" }));
  const mod = (await import(file)) as { default: (pi: unknown) => void };
  const handlers = new Map<string, Handler>();
  const sent: Sent[] = [];
  mod.default({
    on: (event: string, handler: Handler) => void handlers.set(event, handler),
    sendMessage: (message: Note) => void sent.push({ message }),
  });
  const ctx: Context = { cwd: dir, sessionManager: { getSessionId: () => "pi-session-2" } };
  try {
    await handlers.get("session_start")!({ reason: "startup" }, ctx);
    expect(await handlers.get("before_agent_start")!({ prompt: "go" }, ctx)).toBeUndefined();
    await handlers.get("agent_end")!({ messages: [] }, ctx);
    expect(sent).toEqual([]);
  } finally {
    await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
  }
});

test("Pi: the extension Kiwi writes is strictly typed TypeScript", () => {
  const dir = scratch("kiwi-pi-tsc-");
  const file = join(dir, "kiwi.ts");
  writeFileSync(file, piExtensionSource({ "session-start": "a", prompt: "b", stop: "c", listen: "d" }));
  const root = join(import.meta.dir, "..");
  const tsc = Bun.spawnSync(
    [
      join(root, "node_modules", ".bin", "tsc"),
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--noUncheckedIndexedAccess",
      "--target",
      "ES2022",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler",
      "--types",
      "bun",
      "--typeRoots",
      join(root, "node_modules", "@types"),
      file,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(tsc.stdout.toString() + tsc.stderr.toString()).toBe("");
  expect(tsc.exitCode).toBe(0);
}, 60_000);
