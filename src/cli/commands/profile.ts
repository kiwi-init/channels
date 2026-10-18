import * as Effect from "effect/Effect";
import { openSession } from "../../agent.ts";
import { cardLine, charterLines, holdLine, leadLine } from "@kiwi/core/format.ts";
import { COLORS, isColor } from "@kiwi/core/protocol.ts";
import { humanOf } from "@kiwi/core/state.ts";
import { agentPrompt } from "../brief.ts";
import { detectCard } from "../../card.ts";
import { args, opt } from "../args.ts";
import { agentName, channelAlias, type Command, config, die, keepDaemon, out, session } from "../context.ts";
import { list } from "../input.ts";

export const profileCommands: Record<string, Command> = {
  color: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [a, b] = args.slice(1);
      if (!a) {
        const { state } = yield* s.state();
        const held = new Map([...state.members.values()].filter((m) => m.active && m.color).map((m) => [m.color!, m.name]));
        return out(COLORS.map((c) => `${c.padEnd(7)} ${held.get(c) ?? "free"}`).join("\n"));
      }
      if (b !== undefined && a !== s.me) return yield* die("you pick your own colour; the owner sets anyone else's in the Channels app");
      const pick = b ?? a;
      const color = pick === "none" ? null : isColor(pick) ? pick : yield* die(`"${pick}" isn't a colour: ${COLORS.join(", ")} (or none)`);
      yield* s.setColor(s.me, color);
      out(color ? `your colour is ${color}` : "cleared your colour");
    }),

  card: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const { sent, card } = yield* s.refreshCard(detectCard(), {
        ...(opt.model ? { model: opt.model } : {}),
        ...(opt.note ? { note: opt.note } : {}),
        ...(opt.tools ? { tools: list(opt.tools) } : {}),
      });
      out(`${sent ? "card" : "card unchanged"}: ${cardLine(card)}`);
    }),

  hello: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (opt.role || opt.about) return yield* die('the owner sets roles and rules: ask them in a message (kiwi send --to human "…")');
      yield* s.hello();
      const me = (yield* s.state()).state.members.get(s.me);
      out(`announced ${s.me}${me?.role ? ` as ${me.role}` : ""}`);
    }),

  prompt: () =>
    Effect.gen(function* () {
      const alias = yield* channelAlias();
      const cfg = (yield* config).channels[alias];
      const name = yield* agentName(cfg);
      if (cfg) yield* keepDaemon;
      const state = cfg
        ? yield* Effect.flatMap(openSession(alias, cfg, name), (s) => s.state()).pipe(
            Effect.map(({ state }) => state),
            Effect.catchCause(() => Effect.succeed(null)),
          )
        : null;
      const me = state?.members.get(name);
      out(
        agentPrompt(
          alias,
          name,
          state
            ? {
                scopes: me?.scopes,
                hold: holdLine(state),
                charter: charterLines(state),
                lead: leadLine(state, name),
                human: humanOf(state, name),
                role: me?.role,
                about: me?.about,
                ...(me?.persona ? { persona: me.persona } : {}),
              }
            : {},
        ),
      );
    }),
};
