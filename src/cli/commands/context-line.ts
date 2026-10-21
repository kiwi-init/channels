import * as Effect from "effect/Effect";
import { CONTEXT_LINE } from "@kiwi/core/protocol.ts";
import { tokensWord } from "@kiwi/core/format.ts";
import { Keystore, loadConfig } from "../../config.ts";
import { args } from "../args.ts";
import { type Command, die, out } from "../context.ts";

function statusText(on: boolean): string {
  return on
    ? `the context line is on for this computer: past ${tokensWord(CONTEXT_LINE)} tokens, a Claude Code or Codex seat with open tasks, or the lead, gets one line on its next prompt suggesting it write where its work stands with kiwi task checkpoint`
    : `the context line is off for this computer: nothing is said at ${tokensWord(CONTEXT_LINE)} tokens (kiwi context-line on turns it on)`;
}

export const contextLineCommands: Record<string, Command> = {
  "context-line": () =>
    Effect.gen(function* () {
      const sub = args[1] ?? "status";
      if (sub === "status") return out(statusText(loadConfig().contextLine === "on"));
      if (sub !== "on" && sub !== "off") return yield* die("usage: kiwi context-line on|off|status");
      const keys = yield* Keystore;
      yield* keys.update((c) => {
        c.contextLine = sub;
      });
      return out(statusText(sub === "on"));
    }),
};
