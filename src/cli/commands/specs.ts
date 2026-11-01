import * as Effect from "effect/Effect";
import { formatSpec, formatSpecs, planningText, specLine } from "@kiwi/core/spec-lines.ts";
import { parseDuration } from "@kiwi/core/format.ts";
import { oneLook } from "../../agent.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, session } from "../context.ts";
import { text } from "../input.ts";

const PLAN_TTL = "30m";
const USAGE = [
  "usage: kiwi specs [--all]                     the open specs and where each stands",
  "       kiwi spec show N                       #N's spec in full: its stage, Done when and tasks",
  "       kiwi spec write N --file spec.md       write or rewrite the spec of the person's message #N (or the text, or - for stdin)",
  '       kiwi spec tick N "words" [--undo]      tick the box under Done when whose line says those words',
  "       kiwi spec start N                      take an approved spec that waits for an agent, and plan it",
  '       kiwi spec comment N "…" [--on "line"]  comment on #N\'s spec, on one line of it',
].join("\n");

const askArg = (i: number) =>
  Effect.gen(function* () {
    const raw = (args[i] ?? "").replace(/^#/, "");
    const ask = Number(raw);
    return Number.isSafeInteger(ask) && ask > 0 ? ask : yield* die(USAGE);
  });

export const specCommands: Record<string, Command> = {
  specs: () =>
    oneLook(
      Effect.gen(function* () {
        const s = yield* session();
        const { state } = yield* s.state();
        out(formatSpecs(state, opt.all));
      }),
    ),

  spec: () =>
    oneLook(
      Effect.gen(function* () {
        const sub = args[1];
        if (!sub) return yield* specCommands.specs!();
        const s = yield* session();
        if (sub === "show") {
          const ask = yield* askArg(2);
          const { state } = yield* s.state();
          const spec = state.specs.get(ask) ?? (yield* die(`#${ask} has no spec: kiwi spec write ${ask} --file spec.md writes one`));
          return out(formatSpec(state, spec));
        }
        if (sub === "write" || sub === "set") {
          const ask = yield* askArg(2);
          const body = (yield* text(3)).trim() || (yield* die(`give the spec: kiwi spec write ${ask} --file spec.md, or the text, or - for stdin`));
          const spec = yield* s.writeSpec(ask, body);
          const { state } = yield* s.state();
          return out(`wrote ${specLine(state, spec)}`);
        }
        if (sub === "tick") {
          const ask = yield* askArg(2);
          const words = args.slice(3).join(" ").trim() || (yield* die('say which box: kiwi spec tick N "words of its line"'));
          const spec = yield* s.tickSpec(ask, words, !opt.undo);
          const { state } = yield* s.state();
          return out(`${opt.undo ? "unticked" : "ticked"}: ${specLine(state, spec)}`);
        }
        if (sub === "start") {
          const ask = yield* askArg(2);
          const { spec, lease } = yield* s.startSpec(ask, parseDuration(opt.ttl ?? PLAN_TTL));
          const { state } = yield* s.state();
          if (lease.holder !== s.me) return yield* die(`${lease.holder} is already planning #${ask}: take one of its tasks once they're up (kiwi spec show ${ask})`, 3);
          return out(planningText(state, spec));
        }
        if (sub === "comment") {
          const ask = yield* askArg(2);
          const said = args.slice(3).join(" ").trim() || (yield* die('say the comment: kiwi spec comment N "…" --on "the line it\'s about"'));
          const seq = yield* s.commentSpec(ask, said, opt.on);
          return out(`commented on #${ask}'s spec: #${seq}`);
        }
        return yield* die(USAGE);
      }),
    ),
};
