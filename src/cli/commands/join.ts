import { MAX_PIN } from "@kiwi/core/pin.ts";
import * as Effect from "effect/Effect";
import { openSession } from "../../agent.ts";
import { Channel, RelayError } from "@kiwi/core/client.ts";
import { Cursor, Keystore } from "../../config.ts";
import { decodeJoinCode, type ChannelAccess } from "@kiwi/core/crypto.ts";
import { freeAgentName, handleFor, inlineText, readLaunch } from "@kiwi/core/membership.ts";
import { freeHandle } from "@kiwi/core/handles.ts";
import { baseName, here, seatsNear } from "../../seats.ts";
import { asOption, channelOption } from "@kiwi/core/wake.ts";
import { cardLine, charterLines, holdLine, leadLine, parseDuration } from "@kiwi/core/format.ts";
import { canPost, SCOPES } from "@kiwi/core/scopes.ts";
import { fingerprint } from "@kiwi/core/identity.ts";
import { humanOf } from "@kiwi/core/state.ts";
import { kimiSessionHere } from "../../kimi-server.ts";
import { computerClaimFor } from "../../machine.ts";
import { joinedText } from "../brief.ts";
import { autoInstallExtraHooks, autoInstallHooks, bindDirectory, bindingFor } from "../../hooks.ts";
import { notePersonaTold, personaMark } from "../../hooks/persona-line.ts";
import { detectCard, detectModel, detectRuns, mergeCard } from "../../card.ts";
import { args, opt } from "../args.ts";
import { agentName, type Command, config, die, keepDaemon, NAME_RE, out, relayUrl, seatHere } from "../context.ts";

const JOIN_POLL_MS = /^[1-9]\d*$/.test(process.env.KIWI_JOIN_POLL_MS ?? "") ? Number(process.env.KIWI_JOIN_POLL_MS) : 1500;

const OWNER_NAME = "human";

const joinedAlias = Effect.fn("kiwi.joinedAlias")(function* (roomId: string, alias?: string, title?: string | null) {
  const channels = (yield* config).channels;
  const free = (n: string) => !channels[n] || channels[n]!.roomId === roomId;
  if (alias) {
    if (!free(alias)) return yield* die(`the alias "${alias}" is already another channel on this machine; pick a different one`);
    return alias;
  }
  const named = title ? handleFor(title).slice(0, 24) : "";
  const candidates = [named, named && `${named}-${roomId.slice(0, 4)}`, `ch-${roomId.slice(0, 6)}`].filter((n) => n && NAME_RE.test(n));
  return candidates.find(free) ?? `ch-${roomId.slice(0, 8)}`;
});

function settleIn(alias: string, name: string, model: string, harnessSession: string | null): void {
  const hadThisChannel = seatsNear(process.cwd()).some((b) => b.alias === alias);
  if (!bindDirectory(process.cwd(), { ...seatHere(alias, name, true, model), ...(harnessSession ? { harnessSession } : {}) })) {
    process.stderr.write(`kiwi: not binding ${process.cwd()} (too broad); run kiwi from your project folder, or pass ${channelOption(alias)} ${asOption(name)}\n`);
  } else if (!hadThisChannel) {
    const elsewhere = seatsNear(process.cwd()).filter((b) => b.alias !== alias);
    const channels = [...new Set(elsewhere.map((b) => b.alias)), alias];
    if (elsewhere.length)
      process.stderr.write(
        `kiwi: this folder now has seats in ${channels.slice(0, -1).join(", ")} and ${alias}, so commands from it need ${channelOption(alias)} ${asOption(name)} (or ${elsewhere.map((b) => `${channelOption(b.alias)} ${asOption(b.as)}`).join(", ")}) to pick one\n`,
      );
  }
  const installed = autoInstallHooks();
  if (installed) process.stderr.write(`kiwi: installed Claude Code hooks (${installed}) so this agent keeps listening; \`kiwi hooks uninstall\` removes them\n`);
  const extras = autoInstallExtraHooks();
  if (extras) process.stderr.write(`kiwi: installed ${extras} so this agent keeps listening; \`kiwi hooks uninstall\` removes them\n`);
}

const outForGood = (err: unknown) => err instanceof RelayError && (err.tag === "Removed" || err.tag === "Denied" || (!err.tagged && err.status === 403 && /removed|denied/.test(err.message)));

export const joinCommands: Record<string, Command> = {
  join: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const cursor = yield* Cursor;
      const code = (args[1] ?? (yield* die("usage: kiwi join <code> [alias] --model MODEL [--harness NAME] [--nick NAME] [--as HANDLE]"))).trim();
      try {
        decodeJoinCode(code);
      } catch {
        return yield* die("that isn't a join code (they look like mc2-…-…)");
      }
      if (args[2] !== undefined && !NAME_RE.test(args[2])) return yield* die(`the alias ${JSON.stringify(args[2])} is invalid (1-32 letters, digits, _ . or -)`);
      const relay = relayUrl();
      const roomId = decodeJoinCode(code).roomId;
      const who = here();
      const local = yield* keys.identitiesIn(roomId);
      const picked = opt.as ?? process.env.KIWI_AS;
      const aliasHere = Object.entries((yield* keys.config).channels).find(([, c]) => c.roomId === roomId)?.[0];
      const found = picked || !aliasHere ? null : bindingFor(process.cwd(), { who, alias: aliasHere, claim: false });
      if (found && !who.harness && local.includes(found.as)) {
        return yield* die(
          [
            `this folder already has ${found.as}'s seat in ${aliasHere}, and kiwi can't tell what runs you, so it can't tell whether you are ${found.as}.`,
            `If you are ${found.as}: kiwi join ${code} ${asOption(found.as)}`,
            `If you're another agent: kiwi join ${code} --as NAME, then pass --as NAME (or set KIWI_AS=NAME) on every kiwi command you run from here.`,
          ].join("\n"),
          2,
        );
      }
      const seat = found && found.harness === who.harness ? found : null;
      const auto = !picked && !(seat && local.includes(seat.as));
      const askingKey = [roomId, process.cwd(), who.harness ?? "", who.session ?? ""].join(" ");
      let name = picked ? yield* agentName() : seat && !auto ? seat.as : "";
      if (!name) {
        yield* keys.update((c) => {
          const now = Date.now();
          const asking = Object.fromEntries(Object.entries(c.asking ?? {}).filter(([, a]) => now - a.at < 7 * 86_400_000));
          const mine = asking[askingKey]?.as;
          const waiting = Object.entries(asking)
            .filter(([k]) => k.startsWith(`${roomId} `) && k !== askingKey)
            .map(([, a]) => ({ name: a.as }));
          name = mine && local.includes(mine) ? mine : freeHandle([...local.map((n) => ({ name: n })), ...waiting]);
          c.asking = { ...asking, [askingKey]: { as: name, at: mine && local.includes(mine) ? asking[askingKey]!.at : now } };
        });
      }
      const doneAsking = keys.update((c) => {
        if (c.asking) delete c.asking[askingKey];
      });
      if (name === OWNER_NAME) return yield* die(`"${OWNER_NAME}" is reserved for the channel owner; pick an agent name with --as`);
      const hadKey = local.includes(name);
      let id = yield* keys.identity(name, roomId);
      const nick = inlineText(opt.nick ?? (auto ? baseName(who) : ""), 40);
      if (opt.role !== undefined || opt.about !== undefined) process.stderr.write("kiwi: --role and --about are gone: the owner gives you a personality when they let you in\n");
      const info = { name, ...(nick ? { display: nick } : {}), ...(auto ? { auto: true } : {}) };
      const model = opt.model?.trim() || (yield* Effect.promise(() => detectModel()));
      if (!model) {
        yield* doneAsking;
        return yield* die(
          [
            "say what model runs you: the owner sees it on your request and signs it into your seat, and the lead plans work with it.",
            "Run the same command again with --model and the id of the model you run on, for example:",
            `  kiwi join ${code} --model claude-opus-4-1`,
            "(or gpt-5-codex, grok-4, gemini-2.5-pro: the exact name your harness uses for your model. Setting KIWI_MODEL works too.)",
          ].join("\n"),
          2,
        );
      }
      if (opt.persona !== undefined && (opt.persona.length > MAX_PIN || !/^[A-Za-z0-9_-]+$/.test(opt.persona))) {
        yield* doneAsking;
        return yield* die("--persona takes the token from the owner's invite, as it was copied");
      }
      const card = mergeCard(detectCard(), undefined, { model });
      const runs = yield* Effect.promise(() => detectRuns(process.env, { ...(opt.harness ? { harness: opt.harness } : {}), model }));
      if (runs) Object.assign(info, { runs });

      const renameKey = (to: string) =>
        Effect.gen(function* () {
          const names = yield* keys.identitiesIn(roomId);
          const ours: string[] = [];
          for (const n of names) if ((yield* keys.identity(n, roomId)).pk === id.pk) ours.push(n);
          if (names.includes(to) && !ours.includes(to)) {
            const other = yield* keys.identity(to, roomId);
            const aside = freeAgentName(
              to,
              names.map((n) => ({ name: n })),
            );
            yield* keys.saveIdentity({ ...other, name: aside }, roomId);
            yield* keys.forgetIdentity(to, roomId);
            yield* keys.update((c) => {
              for (const [k, a] of Object.entries(c.asking ?? {})) if (k.startsWith(`${roomId} `) && a.as === to) c.asking![k] = { ...a, as: aside };
            });
          }
          if (!ours.includes(to)) yield* keys.saveIdentity({ ...id, name: to }, roomId);
          for (const n of ours) if (n !== to) yield* keys.forgetIdentity(n, roomId);
          id = { ...id, name: to };
          name = to;
        });

      const settle = (access: ChannelAccess, how: "approved" | "resumed") =>
        Effect.gen(function* () {
          if (auto) yield* doneAsking;
          const me = (yield* new Channel(access, relay, id).fx.members()).find((m) => m.active && m.pk === id.pk);
          if (me && me.name !== name) yield* renameKey(me.name);
          const title = yield* new Channel(access, relay, id).fx.title().pipe(Effect.catchCause(() => Effect.succeed(null)));
          const existing = Object.entries((yield* keys.config).channels).find(([, c]) => c.roomId === access.roomId)?.[0];
          const alias = existing && !args[2] ? existing : yield* joinedAlias(access.roomId, args[2], title);
          const cfg = yield* keys.update((c) => {
            const prior = c.channels[alias];
            c.channels[alias] =
              prior?.roomId === access.roomId
                ? { ...prior, ...access, keys: { ...prior.keys, ...access.keys }, as: prior.as ?? name, ...(title ? { title } : {}) }
                : { ...access, relay, code, as: name, ...(title ? { title } : {}) };
          });
          const s = yield* openSession(alias, cfg.channels[alias]!, name);
          const scopes = (yield* s.state()).state.members.get(name)?.scopes ?? [...SCOPES];
          if (how === "resumed") {
            if ((yield* cursor.read(alias, name)) === null) yield* cursor.write(alias, name, yield* s.ch.fx.head());
          } else {
            yield* cursor.write(alias, name, yield* s.ch.fx.head());
            if (canPost(scopes)) yield* s.hello();
          }
          const kimiSession = who.harness === "kimi" ? yield* Effect.promise(() => kimiSessionHere(who.pid, process.cwd())) : null;
          settleIn(alias, name, model, kimiSession);
          if (canPost(scopes)) yield* Effect.ignoreCause(s.refreshCard(detectCard(), { model }));
          process.stderr.write(`${how === "resumed" ? "back in" : "joined"} "${alias}" as ${name} (key ${fingerprint(id.pk)})\n`);
          if (how === "resumed") out("this key is already a member: resumed, nothing new was granted.");
          const { state } = yield* s.state();
          const seat = state.members.get(name);
          out(
            joinedText(alias, name, {
              scopes,
              hold: holdLine(state),
              charter: charterLines(state),
              lead: leadLine(state, name),
              human: humanOf(state, name),
              ...(seat?.persona ? { persona: seat.persona } : {}),
            }),
          );
          if (who.session) notePersonaTold(alias, name, who.session, personaMark(seat?.persona));
          yield* keepDaemon;
        });

      if (hadKey) {
        const access = yield* Channel.fx.resume(relay, code, id).pipe(
          Effect.catchIf(
            (err) => err instanceof RelayError && [401, 403, 404].includes(err.status),
            () => Effect.succeed(null),
          ),
        );
        const local = Object.values((yield* keys.config).channels).find((c) => c.roomId === roomId);
        if (access && (access.keys[String(access.epoch)] ?? local?.keys[String(access.epoch)])) return yield* settle(access, "resumed");
      }
      const launch = readLaunch(process.env.KIWI_LAUNCH);
      const claims = () => Effect.promise(async () => ({ ...(await computerClaimFor(roomId, id.pk)), card, ...(opt.persona ? { pin: opt.persona } : {}), ...(launch ? { launch } : {}) }));
      const req = yield* Channel.fx.requestJoin(relay, code, id, info, yield* claims()).pipe(
        Effect.catchIf(outForGood, () =>
          Effect.gen(function* () {
            yield* keys.forgetIdentity(name, roomId);
            id = yield* keys.identity(name, roomId);
            return yield* Channel.fx.requestJoin(relay, code, id, info, yield* claims());
          }),
        ),
      );
      const wait = opt.timeout ?? "30m";
      out(
        [
          `asked to join as ${name}.`,
          `your request says you run on: ${cardLine(card)}`,
          `waiting for the owner to open your request… Leave this running until it prints "joined" (up to ${wait}). If your shell stops it first, run the exact same command again (same request; with a short tool timeout, add --timeout 2m and repeat). Never type or guess the code it shows.`,
        ].join("\n"),
      );
      const deadline = Date.now() + parseDuration(wait) * 1000;
      let shown: string | null = null;
      for (;;) {
        const st = yield* Channel.fx.joinStatus(relay, code, id, req.requestId);
        if (st.status === "pending" && st.code && st.code !== shown) {
          shown = st.code;
          out(`verification code ${st.code}: the owner sees the same 6 digits next to your request, and approves once they match.`);
        }
        if (st.status === "denied") {
          yield* doneAsking;
          yield* keys.forgetIdentity(name, decodeJoinCode(code).roomId);
          return yield* die("the owner denied this request. Don't ask again unless your person tells you to.");
        }
        if (st.status === "approved") return yield* settle(st.access, "approved");
        if (Date.now() > deadline) {
          return yield* die(
            shown
              ? `still waiting for approval (code ${shown}). This isn't an error: run exactly the same command again to keep waiting (same request, same code).`
              : "the owner hasn't opened your request yet. This isn't an error: run exactly the same command again to keep waiting (same request).",
            3,
          );
        }
        yield* Effect.sleep(JOIN_POLL_MS);
      }
    }),
};
