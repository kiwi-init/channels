// `bun test` is run from inside Grok, Codex, and Claude. Those sessions export
// the same variables `kiwi join` uses to install hooks. A test that joins, or
// that runs `kiwi hooks uninstall`, would then write and strip the developer's
// real harness files. This preload runs for every test file: drop the session
// markers, and point every harness directory (and Claude's settings) at one
// temp directory for this run.
import { afterAll, afterEach, beforeEach } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEDGER_ENV, OWNER_ENV, ownerFor, stopOwned } from "../scripts/ci-owned.ts";
import { ledgerSize } from "./owned.ts";

const root = mkdtempSync(join(tmpdir(), "kiwi-test-harness-"));
for (const name of ["codex", "codex-home", "gemini", "cursor", "grok", "kimi", "pi", "mimo", "zcode", "agy", "claude", "kiwi", "tmux"]) mkdirSync(join(root, name));

const DIRS: Record<string, string> = {
  KIWI_CODEX_DIR: join(root, "codex"),
  CODEX_HOME: join(root, "codex-home"),
  KIWI_GEMINI_DIR: join(root, "gemini"),
  KIWI_CURSOR_DIR: join(root, "cursor"),
  KIWI_GROK_DIR: join(root, "grok"),
  KIWI_KIMI_DIR: join(root, "kimi"),
  KIWI_PI_DIR: join(root, "pi"),
  KIWI_MIMO_DIR: join(root, "mimo"),
  KIWI_ZCODE_DIR: join(root, "zcode"),
  KIWI_AGY_DIR: join(root, "agy"),
  CLAUDE_CONFIG_DIR: join(root, "claude"),
  KIWI_HOME: join(root, "kiwi"),
  KIWI_TMUX_CONF: join(root, "tmux", "tmux.conf"),
  TMUX_TMPDIR: join(root, "tmux"),
};

// The session's id, process and version too: they decide which seat a command acts for, and whether hooks listen.
const SESSION = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PID",
  "AI_AGENT",
  "CLAUDE_CODE_EXECPATH",
  "CODEX_THREAD_ID",
  "GEMINI_CLI",
  "CURSOR_AGENT",
  "CURSOR_CONVERSATION_ID",
  "GROK_SESSION_ID",
  "OPENCODE_SESSION_ID",
  "PI_CODING_AGENT",
  "KIWI_PI_PID",
  "KIWI_PI_SESSION",
  "KIWI_LAUNCH",
  "KIWI_HARNESS",
  "MIMOCODE",
  "MIMOCODE_PID",
  "MIMOCODE_SESSION_ID",
  "ZCODE_RUNTIME_ENV",
  "ANTIGRAVITY_AGENT",
  "ANTIGRAVITY_CONVERSATION_ID",
  "TMUX",
  "TMUX_PANE",
];

function isolate(): void {
  for (const key of SESSION) delete process.env[key];
  // `kiwi join` needs a model: a test's agents say one, unless a test is about not saying one.
  process.env.KIWI_MODEL ??= "test-model";
  process.env.KIWI_JOIN_POLL_MS ??= "100";
  for (const [key, dir] of Object.entries(DIRS)) {
    if (!process.env[key]) process.env[key] = dir;
  }
}

for (const [key, dir] of Object.entries(DIRS)) process.env[key] = dir;
isolate();
beforeEach(isolate);

const ledger = join(root, "spawns.jsonl");
const fileOwner = ownerFor(ledger, "file");
process.env[LEDGER_ENV] = ledger;
process.env[OWNER_ENV] = fileOwner;
let testFrom = 0;
let tests = 0;
beforeEach(() => {
  process.env[LEDGER_ENV] = ledger;
  process.env[OWNER_ENV] = ownerFor(ledger, `test-${++tests}`);
  testFrom = ledgerSize(ledger);
});
afterEach(async () => {
  const owner = process.env[OWNER_ENV];
  process.env[OWNER_ENV] = fileOwner;
  await stopOwned(ledger, testFrom, { owner });
});
afterAll(async () => {
  await stopOwned(ledger, 0, { sweep: true });
});
spawn("sh", ["-c", `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done; exec "$0" "$1" stop "$2"`, process.execPath, join(import.meta.dir, "../scripts/ci-owned.ts"), ledger], {
  detached: true,
  stdio: "ignore",
  env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== LEDGER_ENV && k !== OWNER_ENV)),
}).unref();
