import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { openSession, type Agent } from "../agent.ts";
import { DEFAULT_RELAY, Keystore, type ChannelConfig } from "../config.ts";
import { here, seatsNear } from "../seats.ts";
import { ensureDaemon, reportRead } from "../daemon.ts";
import { seatsFor } from "../hooks.ts";
import { BadName } from "@kiwi/core/refusals.ts";
import { opt } from "./args.ts";

export class Quit extends Data.TaggedError("Quit")<{ readonly message: string; readonly code: number }> {}

export const die = (message: string, code = 1) => Effect.fail(new Quit({ message, code }));

export function out(line: string): void {
  process.stdout.write(line + "\n");
}

export const NAME_RE = /^[\p{L}\p{N}_.-]{1,32}$/u;

export function relayUrl(): string {
  return (opt.relay ?? process.env.KIWI_RELAY ?? DEFAULT_RELAY).replace(/\/+$/, "");
}

export const acting: { alias?: string; name?: string } = {};

export const config = Effect.gen(function* () {
  return yield* (yield* Keystore).config;
});

export const channelAlias = Effect.fn("kiwi.channelAlias")(function* () {
  const cfg = yield* config;
  const all = Object.keys(cfg.channels);
  const explicit = opt.channel ?? process.env.KIWI_CHANNEL;
  const ours = explicit ? [] : seatsFor(process.cwd());
  const named = opt.as ?? process.env.KIWI_AS;
  const fits = ours.length > 1 && named ? ours.filter((b) => b.as === named) : ours;
  const [seat, ...others] = fits;
  if (others.length || (ours.length > 1 && !seat)) {
    return yield* die(`this session is several agents here (${ours.map((b) => `${b.as} in ${b.alias}`).join(", ")}); pass -c ALIAS --as NAME to say which`);
  }
  const alias = explicit ?? seat?.alias ?? (all.length === 1 ? all[0] : undefined);
  if (!alias) {
    if (!all.length) return yield* die("no channel: join one first (kiwi join <code>)");
    return yield* die(`this directory isn't bound to a channel, and this machine is in several (${all.join(", ")}); pass -c ALIAS --as NAME, or run kiwi from the directory you joined in`);
  }
  if (!cfg.channels[alias]) return yield* die(`unknown channel "${alias}" (see: kiwi channels)`);
  acting.alias = alias;
  return alias;
});

export const agentName = Effect.fn("kiwi.agentName")(function* (ch?: ChannelConfig) {
  const keys = yield* Keystore;
  const explicit = opt.as ?? process.env.KIWI_AS;
  let raw = explicit;
  if (!raw && ch) {
    const ours = seatsFor(process.cwd());
    const cfg = yield* keys.config;
    const [bound, ...also] = ours.filter((b) => cfg.channels[b.alias]?.roomId === ch.roomId);
    if (bound && also.length) return yield* die(`this session is several agents in this channel (${[bound, ...also].map((b) => b.as).join(", ")}); pass --as NAME to say which`);
    const held = ours.length ? [] : seatsNear(process.cwd()).filter((b) => cfg.channels[b.alias]?.roomId === ch.roomId);
    if (bound) raw = bound.as;
    else if (held.length && here().session) {
      return yield* die(
        `${held.map((b) => b.as).join(", ")} ${held.length > 1 ? "work" : "works"} from this folder in another session; to take part yourself, run kiwi join with the channel's code (or pass --as NAME)`,
      );
    } else {
      const mine = (yield* keys.identitiesIn(ch.roomId)).filter((n) => n !== ch.owner && n !== ch.person);
      if (mine.length > 1) return yield* die(`several agents on this machine are in this channel (${mine.join(", ")}); pass --as NAME`);
      raw = mine[0] ?? ch.as;
    }
  }
  raw ??= process.env.USER ?? process.env.USERNAME ?? "human";
  const name = raw.trim() || "human";
  if (!NAME_RE.test(name)) return yield* new BadName(`agent name "${name}" is invalid (1-32 letters, digits, _ . or -); pass --as NAME`);
  return name;
});

export const session = Effect.fn("kiwi.session")(function* () {
  const alias = yield* channelAlias();
  const cfg = (yield* config).channels[alias]!;
  acting.name = yield* agentName(cfg);
  const keys = yield* Keystore;
  if (!(yield* keys.identitiesIn(cfg.roomId)).includes(acting.name)) {
    return yield* die(`${acting.name} has no key in "${alias}" on this machine`);
  }
  yield* keepDaemon;
  return yield* openSession(alias, cfg, acting.name);
});

export const keepDaemon = Effect.promise(() =>
  ensureDaemon().then(
    () => undefined,
    (err: unknown) => void process.stderr.write(`kiwi: the daemon didn't start: ${err instanceof Error ? err.message : String(err)}\n`),
  ),
);

export const noteRead = (s: { alias: string; me: string }) => Effect.promise(() => reportRead(s.alias, s.me, here().session));

export function seatHere(alias: string, name: string, plain: boolean, model?: string) {
  const who = here();
  return {
    alias,
    as: name,
    ...(who.harness ? { harness: who.harness } : plain ? { plain: true as const } : {}),
    ...(who.session ? { session: who.session } : {}),
    ...(who.pid ? { pid: who.pid } : {}),
    ...(model ? { model } : {}),
  };
}

export type Command = () => Effect.Effect<void | number, unknown, Agent>;
