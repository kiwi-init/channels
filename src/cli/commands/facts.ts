import * as Effect from "effect/Effect";
import { formatFact, parseDuration } from "../../format.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, session } from "../context.ts";

export const factCommands: Record<string, Command> = {
  note: () => {
    const [key, ...rest] = args.slice(1);
    if (!key) return opt.clear || opt.ttl ? die("usage: kiwi note KEY --clear, or kiwi note KEY VALUE --ttl 7d") : factCommands.facts!();
    if (opt.clear) return factCommands.unset!();
    if (!rest.length && opt.ttl) return die("usage: kiwi note KEY VALUE --ttl 7d (a value to keep for that long)");
    return rest.length ? factCommands.set!() : factCommands.get!();
  },

  set: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [key, ...rest] = args.slice(1);
      if (!key || !rest.length) return yield* die("usage: kiwi set KEY VALUE [--ttl 7d]");
      const value = rest.join(" ");
      const ttl = opt.ttl ? parseDuration(opt.ttl) : undefined;
      yield* s.setFact(key, value, ttl);
      out(ttl ? `${key} = ${value} (for ${opt.ttl})` : `${key} = ${value}`);
    }),

  get: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const key = args[1] ?? (yield* die("usage: kiwi get KEY"));
      const f = (yield* s.state()).state.facts.get(key);
      if (!f) return yield* die(`no fact "${key}"`, 2);
      out(f.value);
    }),

  unset: () =>
    Effect.gen(function* () {
      const s = yield* session();
      yield* s.delFact(args[1] ?? (yield* die("usage: kiwi unset KEY")));
    }),

  facts: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const { facts } = (yield* s.state()).state;
      if (!facts.size) return out("no facts");
      for (const f of [...facts.values()].sort((a, b) => a.key.localeCompare(b.key))) out(formatFact(f));
    }),
};
