export type WakeHarness = "claude" | "codex" | "gemini" | "cursor" | "grok" | "opencode" | "kimi" | "mimo" | "grok-bot";

export type WakeCommand = "codex-queue" | "opencode-api" | "webhook" | "kimi-server";

export type WakePath = { kind: "hooks" } | { kind: "command"; via: WakeCommand; session: string } | { kind: "none"; why: string };

export type WakeVia = "hooks" | "listener" | WakeCommand;

const WAKE_VIA: readonly WakeVia[] = ["hooks", "listener", "codex-queue", "opencode-api", "webhook", "kimi-server"];

export function isWakeVia(v: unknown): v is WakeVia {
  return typeof v === "string" && (WAKE_VIA as readonly string[]).includes(v);
}

export function wakeWords(via: WakeVia): string {
  switch (via) {
    case "hooks":
      return "Claude Code's hooks";
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

export function pullsWake(harness: WakeHarness | undefined): boolean {
  return harness === "kimi" || harness === "cursor";
}

export function viaOf(path: WakePath): WakeVia | null {
  switch (path.kind) {
    case "hooks":
      return "hooks";
    case "command":
      return path.via;
    case "none":
      return null;
  }
}

export function wakePath(record: { harness?: WakeHarness; session?: string; harnessSession?: string; served?: boolean } | null, claudeHooks: boolean, webhook = false): WakePath {
  if (!record) return { kind: "none", why: "no session of a harness Kiwi knows has used this seat yet" };
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
    case "kimi":
      if (!record.served) return { kind: "none", why: "Kimi Code gives Kiwi no way to start a turn in a session run in its terminal; one opened with kimi web (or /web) can be woken" };
      return record.harnessSession ? { kind: "command", via: "kimi-server", session: record.harnessSession } : { kind: "none", why: "Kiwi learns which Kimi Code session this is when its turn ends" };
    case "mimo":
      return { kind: "none", why: "MiMoCode gives Kiwi no way to start a turn in a running session" };
    case "grok-bot":
      return webhook ? { kind: "command", via: "webhook", session: "webhook" } : { kind: "none", why: "no routine webhook is set for it yet (kiwi wake webhook URL)" };
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
  return `New Kiwi messages for you in ${JSON.stringify(alias)}. Read them with: kiwi ${channelOption(alias)} ${asOption(agent)} listen --now, then act on them.`;
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
