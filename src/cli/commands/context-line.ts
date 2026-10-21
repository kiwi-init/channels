import * as Effect from "effect/Effect";
import { CONTEXT_LINE } from "@kiwi/core/protocol.ts";
import { tokensWord } from "@kiwi/core/format.ts";
import { Keystore, loadConfig } from "../../config.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out } from "../context.ts";

function statusText(on: boolean): string {
  return on
    ? `the context line is on for this computer: past ${tokensWord(CONTEXT_LINE)} tokens, the Stop hook asks a Claude Code or Codex seat to write where each of its open tasks stands (and the lead where the channel stands) with kiwi task checkpoint before it ends its turn, once per crossing`
    : `the context line is off for this computer: nothing is said at ${tokensWord(CONTEXT_LINE)} tokens (kiwi context-line on turns it on)`;
}

export const contextLineCommands: Record<string, Command> = {
  "context-line": () =>
    Effect.gen(function* () {
      const sub = args[1] ?? "status";
      const said = (on: boolean) => out(opt.json ? JSON.stringify({ contextLine: on ? "on" : "off" }) : statusText(on));
      if (sub === "status") return said(loadConfig().contextLine === "on");
      if (sub !== "on" && sub !== "off") return yield* die("usage: kiwi context-line on|off|status [--json]");
      const keys = yield* Keystore;
      yield* keys.update((c) => {
        c.contextLine = sub;
      });
      return said(sub === "on");
    }),
};
