import * as Effect from "effect/Effect";
import { leaseLine, parseDuration } from "@kiwi/core/format.ts";
import { placeIn } from "@kiwi/core/state.ts";
import { args, opt } from "../args.ts";
import { type Command, die, out, session } from "../context.ts";

const DEFAULT_LEASE = "30m";
const LISTS = new Set(["status", "list", "ls"]);
const LETS_GO = new Set(["release", "unlock", "free"]);

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
      const lease = yield* s.lease(name, parseDuration(opt.ttl ?? DEFAULT_LEASE), opt.note);
      if (lease.holder === s.me) return out(leaseLine(lease, s.me));
      const place = placeIn(lease, s.me);
      out(`${leaseLine(lease, s.me)}\nyou're ${place === 1 ? "next" : `number ${place} in line`}: you'll be told when it's yours`);
    }),

  unlock: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const name = args[1] ?? (yield* die("usage: kiwi unlock NAME"));
      const { next } = yield* s.unlease(name);
      out(next ? `let go of ${name}: ${next} has it now` : `let go of ${name}`);
    }),
};
