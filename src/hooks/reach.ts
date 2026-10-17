import { COMMANDS } from "../brief.ts";
import { here, type Here } from "../seats.ts";
import { wakePath, wakeWords } from "../wake.ts";
import { hooksListen } from "./install/claude.ts";

function checkEachTurn(mc: string): string {
  return `Run \`${COMMANDS.unread(mc)}\` at the start of every turn and again before you end one. It prints the messages waiting for you, or nothing.`;
}

const KEEP_A_LISTENER = "Kiwi can't wake you in this session from outside, so keep a listener of your own running. It is what wakes you.";

export function wakeYourself(mc: string, harness: Here["harness"]): string | null {
  if (harness === "kimi") {
    return [
      KEEP_A_LISTENER,
      `Now, from your main session (not a subagent), and again every time it wakes you: call the Bash tool with command \`${COMMANDS.listenOnce(mc)}\`, run_in_background: true, disable_timeout: true, description "kiwi messages".`,
      "It ends when a message for you arrives, and Kimi starts your next turn with a notice. The messages are marked read already and won't be shown again, so get all of them:",
      "- If the notice names an output file, read that whole file: it holds your messages.",
      `- If it shows the output inline instead and says it is truncated, the start is cut off: run \`${mc} log -n 100\` (it marks nothing read) and read back to the last message you handled before this wake. If the oldest message it shows is still newer than that one, run it again with a larger -n until it reaches it.`,
      "Don't call WaitFor or TaskOutput while it runs. Before you end any turn, check TaskList shows it running; if not, start it.",
    ].join("\n");
  }
  if (harness === "grok") {
    return [
      KEEP_A_LISTENER,
      `Now, once for this session: start the monitor tool with command \`${COMMANDS.listen(mc)}\`, description "${COMMANDS.listen(mc)}", persistent: true.`,
      "Each message for you arrives as monitor output and starts a turn. Answer it, then end the turn; the monitor keeps running.",
      "If the monitor stops (Grok stops one that prints too much), start it again the same way.",
    ].join("\n");
  }
  return null;
}

export function howMessagesReachYou(mc: string, waking: boolean, who: Here = here()): string {
  if (!waking) return `Kiwi won't wake you: waking is off for you here (\`kiwi wake on\` turns it back on). ${checkEachTurn(mc)}`;
  const path = wakePath(who.harness ? { harness: who.harness, ...(who.session ? { session: who.session } : {}) } : null, hooksListen());
  switch (path.kind) {
    case "hooks":
      return "Messages for you arrive on their own: Kiwi's hooks wake you when one comes. Don't run listen.";
    case "command":
      return `Kiwi wakes you in this session when a message for you arrives (${wakeWords(path.via)}). Don't run listen.`;
    case "none":
      return wakeYourself(mc, who.harness) ?? `Kiwi can't wake you in this session: ${path.why}. ${checkEachTurn(mc)}`;
  }
}
