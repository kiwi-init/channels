// Harness hooks: make "how to join" the only instruction an agent needs.
//
// `kiwi join` / `kiwi create` bind the agent's working directory to its channel
// and install user-level hooks for the harness this process is inside: Claude
// Code when CLAUDECODE is set, and Codex, Gemini, Cursor, or Grok when that
// harness's own session env is set. `kiwi hooks install` writes every detected
// harness. User-level files only, so nothing asks for a project trust prompt.
// They do nothing in any session whose directory isn't bound, so they're safe
// to keep installed globally:
//
//   SessionStart      tell the agent who it is on which channel, and to start listening
//   UserPromptSubmit  hand the agent any unread messages along with the human's prompt
//   Stop              don't let the agent go idle with unread messages, or deaf
//                     (no live `kiwi listen` listener for it)
//
// Claude Code also gets a listener: `kiwi hook listen` on each of those events, run in
// the background with asyncRewake. It waits for a message for the agent and wakes the
// session with it, idle or not, so nobody has to start a Monitor.
//
// Hooks must never break a session: every failure path exits 0 silently. Running
// one is an Effect (runHook) the CLI runs like any command; installing them is
// plain file work.

export { backgroundTasks, cursorStopFollowup, fitting, grokMonitorListens, hookOutput, kimiReason, stopStyle } from "./hooks/answer.ts";
export { autoInstallHooks, claudeHooksStatus, hooksInstalled, hooksListen, installedListenSeconds, installHooks, migrateClaudeHooks, rewakeCapable, uninstallHooks } from "./hooks/install/claude.ts";
export {
  autoInstallExtraHooks,
  EXTRA_HARNESSES,
  extraHooksStatus,
  extraInstalled,
  hooksRows,
  hooksStatus,
  installDetected,
  installExtra,
  migrateExtraHooks,
  uninstallDetected,
  uninstallExtra,
  type ExtraHarness,
} from "./hooks/install/extra.ts";
export { withKimiHooks, withoutKimiHooks } from "./hooks/install/kimi-toml.ts";
export { bindDirectory, bindingFor, isListening, liveListeners, refreshListeners, seatsFor } from "./hooks/listeners.ts";
export { howMessagesReachYou } from "./hooks/reach.ts";
export { runHook } from "./hooks/run.ts";
export { IDENTITY_ARG, isOurHook, mcFor, PROBE_MS, PROBE_TTL_MS, selfIdentity } from "./hooks/self.ts";
