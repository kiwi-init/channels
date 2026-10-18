import * as Effect from "effect/Effect";
import { existsSync, readFileSync } from "node:fs";
import { inlineText } from "@kiwi/core/membership.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, session } from "../context.ts";

export const compactCommands: Record<string, Command> = {
  compact: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (opt.file && !existsSync(opt.file)) return yield* die(`no file ${opt.file}`);
      const text = opt.file ? readFileSync(opt.file, "utf8") : args.slice(1).join(" ");
      if (!text.trim()) {
        const { state } = yield* s.state();
        if (state.compact) out(`compacted through #${state.compact.through} by ${state.compact.by}:\n${state.compact.summary}`);
        if (state.compactProposal)
          out(`${state.compact ? "\n" : ""}proposed by ${state.compactProposal.by}, through #${state.compactProposal.through}, waiting on the owner:\n${state.compactProposal.summary}`);
        if (!state.compact && !state.compactProposal) out("not compacted: kiwi compact --file summary.md proposes a summary for the owner to approve");
        return;
      }
      const { seq, through } = yield* s.proposeCompact(text);
      out(`proposed #${seq}: folds the history through #${through} once the owner approves it (${inlineText(text, 80)})`);
    }),
};
