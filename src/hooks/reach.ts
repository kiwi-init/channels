import { COMMANDS } from "../brief.ts";
import { kimiServer } from "../kimi-server.ts";
import { here, type Here } from "../seats.ts";
import { viaOf, wakePath, wakeWords, type WakePath } from "@kiwi/core/wake.ts";
import { hooksListen } from "./install/claude.ts";
import { extraInstalled } from "./install/extra.ts";
import { mimoInstalled } from "./install/mimo.ts";
import { piInstalled } from "./install/pi.ts";
import { tmuxPlaceFrom } from "../tmux-pane.ts";

function checkEachTurn(mc: string): string {
  return `Run \`${COMMANDS.join(mc)}\` at the start of every turn and again before you end one. It prints the messages waiting for you, or says there are none.`;
}

const KEEP_A_LISTENER = "Kiwi can't wake you in this session from outside, so keep a listener of your own running. It is what wakes you.";

export type ListenMode = "read" | "once" | "stream";

const kimiServed = (who: Here) => who.harness === "kimi" && kimiServer(who.pid) && extraInstalled("kimi");

function pathHere(who: Here, webhook: boolean, pane: string | undefined = tmuxPlaceFrom(process.env).tmux?.pane): WakePath {
  return wakePath(who.harness ? { harness: who.harness, ...(who.session ? { session: who.session } : {}), ...(pane ? { tmux: { pane } } : {}) } : null, hooksListen(), webhook, {
    pi: piInstalled(),
    mimo: mimoInstalled(),
  });
}

export function wokenBy(waking: boolean, who: Here = here(), webhook = false): string | null {
  if (!waking) return null;
  if (kimiServed(who)) return wakeWords("kimi-server");
  const via = viaOf(pathHere(who, webhook));
  return via ? wakeWords(via) : null;
}

export function listenMode(waking: boolean, who: Here = here(), webhook = false): ListenMode {
  if (!waking || wokenBy(waking, who, webhook)) return "read";
  if (who.harness === "grok") return "stream";
  return who.harness === "kimi" || who.harness === "cursor" || who.harness === "zcode" ? "once" : "read";
}

export function startListener(mc: string, harness: Here["harness"]): string | null {
  const join = COMMANDS.join(mc);
  if (harness === "kimi")
    return `Now, from your main session (not a subagent), and again every time it wakes you: call the Bash tool with command \`${join}\`, run_in_background: true, disable_timeout: true, description "kiwi messages".`;
  if (harness === "grok") return `Now, once for this session: start the monitor tool with command \`${join}\`, description "${join}", persistent: true.`;
  if (harness === "zcode") return `Now, and again every time it wakes you: call the Bash tool with command \`${join}\`, run_in_background: true, and no timeout.`;
  if (harness === "cursor") return `Now, and again every time it wakes you: run \`${join}\` with the Shell tool as a background command (is_background: true).`;
  return null;
}

export function runInBackground(harness: Here["harness"]): string | null {
  if (harness === "kimi") return "with the Bash tool as a background task (run_in_background: true, disable_timeout: true)";
  if (harness === "grok") return "with the monitor tool (persistent: true)";
  if (harness === "zcode") return "with the Bash tool as a background task (run_in_background: true, no timeout)";
  if (harness === "cursor") return "with the Shell tool as a background command (is_background: true)";
  return null;
}

export function wakeYourself(mc: string, harness: Here["harness"]): string | null {
  const start = startListener(mc, harness);
  if (harness === "kimi" && start) {
    return [
      KEEP_A_LISTENER,
      start,
      "It ends when a message for you arrives, and Kimi starts your next turn with a notice. The messages are marked read already and won't be shown again, so get all of them:",
      "- If the notice names an output file, read that whole file: it holds your messages.",
      `- If it shows the output inline instead and says it is truncated, the start is cut off: run \`${mc} log -n 100\` (it marks nothing read) and read back to the last message you handled before this wake. If the oldest message it shows is still newer than that one, run it again with a larger -n until it reaches it.`,
      "Don't call WaitFor or TaskOutput while it runs. Before you end any turn, check TaskList shows it running; if not, start it.",
    ].join("\n");
  }
  if (harness === "grok-bot") {
    return [
      "Kiwi can wake you through a Grok Bot routine, once it has one: ask your owner to create a routine that an incoming webhook starts, then run",
      "`printf %s \"$AUTHORIZATION\" | kiwi wake webhook <the routine's URL>` with the routine's Authorization header in AUTHORIZATION, so it never lands in your shell history or the channel.",
      `Until then: ${checkEachTurn(mc)}`,
    ].join("\n");
  }
  if (harness === "cursor" && start) {
    return [
      KEEP_A_LISTENER,
      start,
      "It ends when a message for you arrives, and Cursor starts your next turn with its output. The messages are marked read already and won't be shown again, so read all of that output.",
      "Don't wait on it with Await. Before you end any turn, check it is still running; if not, start it.",
    ].join("\n");
  }
  if (harness === "zcode" && start) {
    return [
      KEEP_A_LISTENER,
      start,
      "It ends when a message for you arrives, and ZCode starts your next turn when it exits. The messages are marked read already and won't be shown again, so read all of its output: if the notice names an output file, read that whole file.",
      "Before you end any turn, check it is still running; if not, start it.",
    ].join("\n");
  }
  if (harness === "grok" && start) {
    return [
      KEEP_A_LISTENER,
      start,
      "Each message for you arrives as monitor output and starts a turn. Answer it, then end the turn; the monitor keeps running.",
      "If the monitor stops (Grok stops one that prints too much), start it again the same way.",
    ].join("\n");
  }
  return null;
}

export function howMessagesReachYou(mc: string, waking: boolean, who: Here = here(), webhook = false, pane: string | undefined = tmuxPlaceFrom(process.env).tmux?.pane): string {
  if (!waking) return `Kiwi won't wake you: waking is off for you here (\`kiwi wake on\` turns it back on). ${checkEachTurn(mc)}`;
  if (kimiServed(who)) return `Kiwi wakes you in this session when a message for you arrives (${wakeWords("kimi-server")}). Don't keep a listener running.`;
  const path = pathHere(who, webhook, pane);
  switch (path.kind) {
    case "hooks":
      return "Messages for you arrive on their own: Kiwi's hooks wake you when one comes. Don't keep a listener running.";
    case "extension":
      return `Messages for you arrive on their own: ${wakeWords(path.via)} wakes you when one comes. Don't keep a listener running.`;
    case "command":
      return `Kiwi wakes you in this session when a message for you arrives (${wakeWords(path.via)}). Don't keep a listener running.`;
    case "none":
      return wakeYourself(mc, who.harness) ?? `Kiwi can't wake you in this session: ${path.why}. ${checkEachTurn(mc)}`;
  }
}
