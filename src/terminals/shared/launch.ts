import { basename } from "node:path";

const POSIX = new Set(["sh", "bash", "zsh", "ksh", "mksh", "dash", "yash"]);

export const SESSION_MARKERS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SSE_PORT",
  "CODEX_THREAD_ID",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "GROK_SESSION_ID",
  "GEMINI_CLI",
  "CURSOR_AGENT",
  "CURSOR_CONVERSATION_ID",
  "CURSOR_TRACE_ID",
  "OPENCODE",
  "OPENCODE_SESSION_ID",
  "PI_CODING_AGENT",
  "MIMOCODE",
  "MIMOCODE_PID",
  "MIMOCODE_SESSION_ID",
  "ZCODE_RUNTIME_ENV",
  "KIWI_AS",
  "KIWI_LOOP",
  "KIWI_LOOP_TASK",
  "KIWI_HARNESS",
  "KIWI_LAUNCH",
  "KIWI_MODEL",
  "KIWI_PI_PID",
  "KIWI_PI_SESSION",
];

const pairs = (env: Record<string, string>): string[] => Object.entries(env).map(([key, value]) => `${key}=${value}`);

export function loginArgv(shell: string, argv: readonly string[], env: Record<string, string> = {}): string[] {
  const name = basename(shell);
  const login = name === "fish" ? [shell, "-ilc", "exec $argv"] : [POSIX.has(name) ? shell : "/bin/sh", "-ilc", 'exec "$@"', "kiwi-launch"];
  return ["/usr/bin/env", ...SESSION_MARKERS.flatMap((key) => ["-u", key]), ...pairs(env), ...login, ...argv];
}

function quote(word: string): string {
  return `'${word.replace(/'/g, "'\\''")}'`;
}

export const shellWord = (w: string): string => (/^[\w@%+=:,./-]+$/.test(w) ? w : quote(w));
