import * as Effect from "effect/Effect";
import { leaseLine, parseDuration } from "@kiwi/core/format.ts";
import { placeIn } from "@kiwi/core/state.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, session } from "../context.ts";

const DEFAULT_LEASE = "30m";
const LISTS = new Set(["status", "list", "ls"]);
const LETS_GO = new Set(["release", "unlock", "free"]);
const IN_LINE = 3;
const WAIT_POLL_MS = 2_000;

export const leaseCommands: Record<string, Command> = {
  lock: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const name = args[1];
      if (name && LETS_GO.has(name)) return yield* die(`kiwi lock ${name} takes no lease named "${name}": let one go with kiwi unlock ${args[2] ?? "NAME"}`);
      if (!name || LISTS.has(name)) {
        const { state } = yield* s.state();
        if (!state.leases.size) return out("no leases: kiwi lock NAME [--ttl 30m] [--note why] takes one");
        for (const l of [...state.leases.values()].sort((a, b) => a.name.localeCompare(b.name))) out(leaseLine(l, s.me));
        return;
      }
      const wait = opt.wait === undefined ? null : parseDuration(opt.wait);
      const lease = yield* s.lease(name, parseDuration(opt.ttl ?? DEFAULT_LEASE), opt.note);
      if (lease.holder === s.me) return out(leaseLine(lease, s.me));
      const place = placeIn(lease, s.me);
      out(leaseLine(lease, s.me));
      if (wait === null)
        return yield* die(
          `you're ${place === 1 ? "next" : `number ${place} in line`} for ${name}, not holding it: you'll be told when it's yours (kiwi lock ${name} --wait 30m waits for it)`,
          IN_LINE,
        );
      const until = Date.now() + wait * 1000;
      while (Date.now() < until) {
        yield* Effect.sleep(WAIT_POLL_MS);
        const now = (yield* s.state()).state.leases.get(name);
        if (now?.holder === s.me) return out(leaseLine(now, s.me));
        if (!now || placeIn(now, s.me) === 0) return yield* die(`you're no longer in line for ${name}: kiwi lock ${name} asks again`, IN_LINE);
      }
      yield* s.unlease(name);
      return yield* die(`${name} wasn't yours within ${opt.wait}: you left the line (kiwi lock ${name} --wait asks again)`, 2);
    }),

  unlock: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const name = args[1] ?? (yield* die("usage: kiwi unlock NAME"));
      const { next } = yield* s.unlease(name);
      out(next ? `let go of ${name}: ${next} has it now` : `let go of ${name}`);
    }),
};
