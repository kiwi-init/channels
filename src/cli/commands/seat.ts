import * as Effect from "effect/Effect";
import { NAME_RE, nameKey, namesOf, RESERVED_NAMES } from "@kiwi/core/membership.ts";
import { rosterOf } from "@kiwi/core/state.ts";
import { Keystore } from "../../config.ts";
import { bindHeldSeat, holdSeat, isSeatHarness, newSeatToken, releaseSeat, SEAT_TOKEN, type HeldSession, type HoldChange } from "../../hold.ts";
import { args, opt } from "../args.ts";
import { agentName, channelAlias, type Command, config, die, out, type Quit, session } from "../context.ts";

const USAGE = `usage: kiwi seat hold | bind --harness HARNESS (--session ID [--pid PID] | --pid PID for kimi) | release (bind and release read ${SEAT_TOKEN}) | rename NEW`;

const rename = Effect.fn("kiwi.seat.rename")(function* (wanted: string | undefined) {
  const to = wanted?.trim().replace(/^@/, "");
  if (!to) return yield* die("usage: kiwi seat rename NEW");
  if (!NAME_RE.test(to)) return yield* die(`"${to}" isn't a valid handle (1-32 letters, digits, _ . or -)`);
  if (RESERVED_NAMES.has(nameKey(to))) return yield* die(`"${to}" is a reserved name`);
  const s = yield* session();
  const roster = rosterOf(yield* s.ch.fx.members());
  const mine = roster.find((r) => r.pk === s.identity.pk);
  if (!mine?.active) return yield* die(`${s.me} has no seat in "${s.alias}" any more`);
  if (mine.name === to) {
    if (s.me === to) return out(`${to} is already this seat's handle in "${s.alias}"`);
    const keys = yield* Keystore;
    if ((yield* keys.identitiesIn(s.cfg.roomId)).includes(to) && (yield* keys.identity(to, s.cfg.roomId)).pk !== s.identity.pk)
      return yield* die(`this computer already has another key named ${to} in "${s.alias}": remove it first`);
    yield* keys.renameMember(s.alias, s.identity, to);
    out(`${s.me} in "${s.alias}" is ${to} on this computer too: same key, tasks and history`);
    process.stderr.write(`kiwi: restart anything listening as ${s.me} (kiwi listen, a loop, a harness session) so it answers as ${to}\n`);
    return;
  }
  if (roster.some((r) => r.pk !== mine.pk && namesOf(r).some((n) => nameKey(n) === nameKey(to)))) return yield* die(`"${to}" is, or was, someone else's name in "${s.alias}"`);
  const owner = roster.find((r) => r.owner);
  if (!owner) return yield* die(`"${s.alias}" has no owner to ask`);
  const seq = yield* s.send(`@${owner.name}: please rename my handle @${mine.name} to @${to}. In the app, open my menu and choose Change handle; I keep my key, tasks and history.`, {
    kind: "ask",
    to: [owner.name],
  });
  out(`asked the owner to rename ${mine.name} to ${to} in "${s.alias}" (#${seq}); once they have, run kiwi seat rename ${to} again`);
});

export const seatNamed = Effect.gen(function* () {
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

const boundTo = Effect.suspend((): Effect.Effect<HeldSession, Quit> => {
  const harness = opt.harness;
  const session = opt.session;
  const pid = opt.pid === undefined ? undefined : Number(opt.pid);
  if (!isSeatHarness(harness) || (pid !== undefined && !(Number.isInteger(pid) && pid > 0))) return die(USAGE);
  switch (harness) {
    case "grok-bot":
      return die("a Grok Bot has no session to bind: its routine's webhook wakes it");
    case "kimi":
      return pid ? Effect.succeed({ harness, pid, ...(session ? { served: session } : {}) }) : die("Kimi Code's seat is its process: pass --pid PID (and --session ID for a session kimi web serves)");
    default:
      return session ? Effect.succeed({ harness, session, ...(pid ? { pid } : {}) }) : die(USAGE);
  }
});

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
        const to = yield* boundTo;
        const token = yield* tokenOrUsage;
        const { alias, name } = yield* seatNamed;
        return yield* settled(
          bindHeldSeat(alias, name, token, to),
          alias,
          name,
          `${name} in ${alias} is bound to ${to.harness} ${to.harness === "kimi" ? `process ${to.pid}` : `session ${to.session}`}`,
        );
      }
      if (sub === "rename") return yield* rename(args[2]);
      if (sub === "release") {
        const token = yield* tokenOrUsage;
        const { alias, name } = yield* seatNamed;
        return yield* settled(releaseSeat(alias, name, token), alias, name, `${name} in ${alias} is released`);
      }
      return yield* die(USAGE);
    }),
};
