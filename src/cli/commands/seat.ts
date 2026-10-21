import * as Effect from "effect/Effect";
import { Keystore } from "../../config.ts";
import { bindHeldSeat, holdSeat, isSeatHarness, newSeatToken, releaseSeat, SEAT_TOKEN, type HoldChange } from "../../hold.ts";
import { args, opt } from "../args.ts";
import { agentName, channelAlias, type Command, config, die, out } from "../context.ts";

const USAGE = `usage: kiwi seat hold | bind --harness HARNESS --session ID [--pid PID] | release (bind and release read ${SEAT_TOKEN})`;

const seatNamed = Effect.gen(function* () {
  const alias = yield* channelAlias();
  const ch = (yield* config).channels[alias];
  if (!ch) return yield* die(`unknown channel "${alias}" (see: kiwi channels)`);
  const name = yield* agentName(ch);
  if (!(yield* (yield* Keystore).identitiesIn(ch.roomId)).includes(name)) return yield* die(`${name} has no key in "${alias}" on this machine`);
  return { alias, name };
});

const settled = (change: HoldChange, alias: string, name: string, done: string) => {
  switch (change.kind) {
    case "changed":
      return Effect.sync(() => out(done));
    case "no-seat":
      return die(`${name} has no seat in ${alias} on this computer: kiwi join from its folder first`);
    case "not-held":
      return die(`${name} in ${alias} isn't held: kiwi seat hold first`);
    case "other-holder":
      return die(`${name} in ${alias} is held with another ${SEAT_TOKEN}`);
  }
};

const tokenOrUsage = Effect.suspend(() => {
  const token = process.env[SEAT_TOKEN];
  return token ? Effect.succeed(token) : die(`${USAGE}: ${SEAT_TOKEN} isn't set`);
});

export const seatCommands: Record<string, Command> = {
  seat: () =>
    Effect.gen(function* () {
      const sub = args[1];
      if (sub === "hold") {
        const given = process.env[SEAT_TOKEN];
        const token = given || newSeatToken();
        const { alias, name } = yield* seatNamed;
        yield* settled(holdSeat(alias, name, token), alias, name, given ? `${name} in ${alias} is held` : token);
        process.stderr.write(`kiwi: only a process with this ${SEAT_TOKEN} reads for ${name} in ${alias} until kiwi seat bind hands it to a session\n`);
        return;
      }
      if (sub === "bind") {
        const harness = opt.harness;
        const session = opt.session;
        const pid = opt.pid === undefined ? undefined : Number(opt.pid);
        if (!isSeatHarness(harness) || !session || (pid !== undefined && !(Number.isInteger(pid) && pid > 0))) return yield* die(USAGE);
        const token = yield* tokenOrUsage;
        const { alias, name } = yield* seatNamed;
        return yield* settled(bindHeldSeat(alias, name, token, { harness, session, ...(pid ? { pid } : {}) }), alias, name, `${name} in ${alias} is bound to ${harness} session ${session}`);
      }
      if (sub === "release") {
        const token = yield* tokenOrUsage;
        const { alias, name } = yield* seatNamed;
        return yield* settled(releaseSeat(alias, name, token), alias, name, `${name} in ${alias} is released`);
      }
      return yield* die(USAGE);
    }),
};
