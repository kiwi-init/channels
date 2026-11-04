import * as Effect from "effect/Effect";
import { formatFact, parseDuration } from "@kiwi/core/format.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, session } from "../context.ts";
import { text } from "../input.ts";

const store = (key: string, value: string) =>
  Effect.gen(function* () {
    const s = yield* session();
    const ttl = opt.ttl ? parseDuration(opt.ttl) : undefined;
    yield* s.setFact(key, value, ttl);
    out(ttl ? `${key} = ${value} (for ${opt.ttl})` : `${key} = ${value}`);
  });

export const factCommands: Record<string, Command> = {
  note: () =>
    Effect.gen(function* () {
      const key = args[1];
      if (!key) return yield* opt.clear || opt.ttl ? die("usage: kiwi note KEY --clear, or kiwi note KEY VALUE --ttl 7d") : factCommands.facts!();
      if (opt.clear) return yield* factCommands.unset!();
      const value = yield* text(2);
      if (value) return yield* store(key, value);
      if (opt.file !== undefined) return yield* die(`${opt.file} is empty: nothing to keep in "${key}"`);
      if (opt.ttl) return yield* die("usage: kiwi note KEY VALUE --ttl 7d (a value to keep for that long)");
      return yield* factCommands.get!();
    }),

  set: () =>
    Effect.gen(function* () {
      const key = args[1];
      const value = key ? yield* text(2) : "";
      if (!key || !value) return yield* die("usage: kiwi set KEY VALUE [--ttl 7d], or the value with --file PATH or on stdin");
      yield* store(key, value);
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
