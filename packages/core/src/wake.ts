export type WakeHarness = "claude" | "codex" | "gemini" | "cursor" | "grok" | "opencode" | "kimi" | "mimo" | "grok-bot" | "pi" | "zcode";

export type WakeCommand = "codex-queue" | "opencode-api" | "webhook" | "kimi-server";

export type WakePath = { kind: "hooks" } | { kind: "extension"; via: WakeExtension } | { kind: "command"; via: WakeCommand; session: string } | { kind: "none"; why: string };

type WakeExtension = "pi-extension" | "mimo-plugin";

export type WakeVia = "hooks" | WakeExtension | "listener" | WakeCommand;

const WAKE_VIA: readonly WakeVia[] = ["hooks", "pi-extension", "mimo-plugin", "listener", "codex-queue", "opencode-api", "webhook", "kimi-server"];

export function isWakeVia(v: unknown): v is WakeVia {
  return typeof v === "string" && (WAKE_VIA as readonly string[]).includes(v);
}

export function wakeWords(via: WakeVia): string {
  switch (via) {
    case "hooks":
      return "Claude Code's hooks";
    case "pi-extension":
      return "Kiwi's Pi extension";
    case "mimo-plugin":
      return "Kiwi's MiMoCode plugin";
    case "listener":
      return "its background listener";
    case "codex-queue":
      return "codex queue";
    case "opencode-api":
      return "OpenCode's service";
    case "webhook":
      return "its routine's webhook";
    case "kimi-server":
      return "Kimi's server";
  }
}

export function wakesInSession(via: string | undefined): boolean {
  return via === "hooks" || via === "pi-extension" || via === "mimo-plugin";
}

export function pullsWake(harness: WakeHarness | undefined): boolean {
  return harness === "kimi" || harness === "cursor" || harness === "grok" || harness === "zcode";
}

export function listenedPath(path: WakePath, listening: boolean): WakePath {
  if (path.kind !== "extension" || listening) return path;
  return path.via === "mimo-plugin"
    ? { kind: "none", why: "Kiwi's MiMoCode plugin has no listener running for this session (it starts with the session or its first shell command; restarting MiMoCode starts it again)" }
    : { kind: "none", why: "Kiwi's Pi extension has no listener running for this session (/reload in Pi starts it again)" };
}

export function viaOf(path: WakePath): WakeVia | null {
  switch (path.kind) {
    case "hooks":
      return "hooks";
    case "extension":
      return path.via;
    case "command":
      return path.via;
    case "none":
      return null;
  }
}

export function wakePath(
  record: { harness?: WakeHarness; session?: string; harnessSession?: string; served?: boolean; held?: boolean } | null,
  claudeHooks: boolean,
  webhook = false,
  extensions: { pi?: boolean; mimo?: boolean } = {},
): WakePath {
  if (!record) return { kind: "none", why: "no session of a harness Kiwi knows has used this seat yet" };
  if (record.held) return { kind: "none", why: "its loop holds it between sessions, and wakes nothing until it hands the seat to a new session" };
  switch (record.harness) {
    case "claude":
      return claudeHooks ? { kind: "hooks" } : { kind: "none", why: "Claude Code's listening hooks aren't installed, or this Claude Code is older than 2.1.296 (kiwi hooks install)" };
    case "codex":
      return record.session ? { kind: "command", via: "codex-queue", session: record.session } : { kind: "none", why: "Codex didn't say which thread this is" };
    case "opencode":
      return record.session ? { kind: "command", via: "opencode-api", session: record.session } : { kind: "none", why: "OpenCode didn't say which session this is" };
    case "grok":
      return { kind: "none", why: "Kiwi can't tell whether a Grok session is live in its leader, and waking one that isn't would start a second copy" };
    case "gemini":
      return { kind: "none", why: "Gemini CLI gives Kiwi no way to start a turn in a running session" };
    case "cursor":
      return { kind: "none", why: "Cursor gives Kiwi no way to start a turn in a running session" };
    case "zcode":
      return { kind: "none", why: "ZCode gives Kiwi no way to start a turn in a running session" };
    case "kimi":
      if (!record.served) return { kind: "none", why: "Kimi Code gives Kiwi no way to start a turn in a session run in its terminal; one opened with kimi web (or /web) can be woken" };
      return record.harnessSession ? { kind: "command", via: "kimi-server", session: record.harnessSession } : { kind: "none", why: "Kiwi learns which Kimi Code session this is when its turn ends" };
    case "mimo":
      if (!extensions.mimo) return { kind: "none", why: "Kiwi's MiMoCode plugin isn't installed (kiwi hooks install mimo, then restart MiMoCode)" };
      return record.session && !record.session.startsWith("mimo-pid-")
        ? { kind: "extension", via: "mimo-plugin" }
        : { kind: "none", why: "this MiMoCode session started before Kiwi's MiMoCode plugin was installed (restarting MiMoCode loads it)" };
    case "grok-bot":
      return webhook ? { kind: "command", via: "webhook", session: "webhook" } : { kind: "none", why: "no routine webhook is set for it yet (kiwi wake webhook URL)" };
    case "pi":
      if (!extensions.pi) return { kind: "none", why: "Kiwi's Pi extension isn't installed (kiwi hooks install pi, then /reload in Pi)" };
      return record.session ? { kind: "extension", via: "pi-extension" } : { kind: "none", why: "this Pi session started before Kiwi's Pi extension was installed (/reload in Pi loads it)" };
    case undefined:
      return { kind: "none", why: "Kiwi doesn't recognise this agent's harness" };
  }
}

function shellWord(s: string): string {
  return /^[A-Za-z0-9_.@%+=:,/-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export function channelOption(alias: string): string {
  return alias.startsWith("-") ? shellWord(`--channel=${alias}`) : `-c ${shellWord(alias)}`;
}

export function asOption(name: string): string {
  return name.startsWith("-") ? shellWord(`--as=${name}`) : `--as ${shellWord(name)}`;
}

export function wakePrompt(alias: string, agent: string): string {
  return `New Kiwi messages for you in ${JSON.stringify(alias)}. If they aren't shown here, read them with: kiwi ${channelOption(alias)} ${asOption(agent)} listen --now, then act on them.`;
}

export function wakeArgv(via: Exclude<WakeCommand, "webhook" | "kimi-server">, session: string, prompt: string): string[] {
  switch (via) {
    case "codex-queue":
      return ["codex", "queue", "--thread", session, "--message", prompt];
    case "opencode-api":
      return ["opencode", "api", "session.prompt", "--param", `sessionID=${session}`, "-d", JSON.stringify({ text: prompt, delivery: "queue" })];
  }
}

export function wakeKey(alias: string, agent: string): string {
  return `${alias}/${agent}`;
}

export interface WakeSeat {
  room: string;
  alias: string;
  agent: string;
  wake: "on" | "off";
}

export function readWakeSeat(x: unknown): WakeSeat | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (typeof r.room !== "string" || !/^[0-9a-f]{32}$/.test(r.room) || typeof r.alias !== "string" || !r.alias || typeof r.agent !== "string" || !r.agent) return null;
  if (r.wake !== "on" && r.wake !== "off") return null;
  return { room: r.room, alias: r.alias, agent: r.agent, wake: r.wake };
}
