import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { ago, describeEvent, parseDuration } from "@kiwi/core/format.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import { mcFor } from "../../hooks.ts";
import { detectCard } from "../../card.ts";
import { daemonListeners } from "../../daemon.ts";
import { args, opt } from "../args.ts";
import { type Command, die, noteRead, out, session } from "../context.ts";
import { delivery, render } from "../input.ts";

const nothingUnread = (alias: string, me: string) =>
  Effect.gen(function* () {
    const log = `\`${mcFor(alias, me)} log -n 10\``;
    const running = (yield* Effect.promise(() => daemonListeners().catch(() => []))).filter((l) => l.kind === "listen" && l.marks === true && l.channel === alias && l.agent === me);
    const first = running.reduce<number | null>((at, l) => (at === null || l.at < at ? l.at : at), null);
    if (first === null) return `nothing unread; ${log} shows what was already delivered`;
    const which = running.length === 1 ? `a Kiwi listener for ${me} is running` : `${running.length} Kiwi listeners for ${me} are running`;
    const where = [...new Set(running.flatMap((l) => (l.cwd ? [l.cwd] : [])))];
    return `nothing unread: ${which} (since ${ago(first)}${where.length ? `, in ${where.join(", ")}` : ""}) and marks each message read as it hands it on, so those won't show as unread here; ${log} shows the latest`;
  });

export const listenCommands: Record<string, Command> = {
  listen: () => {
    if (opt.now && (opt.once || opt.timeout)) return die("--now doesn't wait: leave out --once and --timeout");
    return opt.webhook ? listenCommands.watch!() : opt.now ? listenCommands.read!() : opt.once || opt.timeout ? listenCommands.wait!() : listenCommands.tail!();
  },

  read: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const { messages, state } = yield* s.read(yield* delivery(s));
      for (const m of messages) out(render(m, state));
      if (!messages.length) process.stderr.write(`${yield* nothingUnread(s.alias, s.me)}\n`);
      yield* noteRead(s);
    }),

  tail: () =>
    Effect.gen(function* () {
      const s = yield* session();
      yield* Effect.forkDetach(Effect.ignoreCause(s.refreshCard(detectCard())));
      yield* s.listen((m, state) => Effect.sync(() => out(render(m, state))), {
        ...(yield* delivery(s)),
        onStatus: (msg) => Effect.sync(() => void process.stderr.write(`kiwi: ${msg}\n`)),
        onNotice: (text) => Effect.sync(() => out(`* ${text}`)),
      });
    }),

  wait: () =>
    Effect.gen(function* () {
      const s = yield* session();
      yield* Effect.forkDetach(Effect.ignoreCause(s.refreshCard(detectCard())));
      let got = 0;
      const enough = yield* Deferred.make<void>();
      const woke = Effect.suspend(() => (got++ === 0 ? Effect.asVoid(Effect.forkScoped(Effect.andThen(Effect.sleep(400), Deferred.succeed(enough, undefined)))) : Effect.void));
      const listening = s.listen(
        (m, state) =>
          Effect.andThen(
            Effect.sync(() => out(render(m, state))),
            woke,
          ),
        {
          ...(yield* delivery(s)),
          onStatus: (msg) => Effect.sync(() => void process.stderr.write(`kiwi: ${msg}\n`)),
          onNotice: (text) =>
            Effect.andThen(
              Effect.sync(() => out(`* ${text}`)),
              woke,
            ),
        },
      );
      const timeout = opt.timeout ? Effect.sleep(parseDuration(opt.timeout) * 1000) : Effect.never;
      yield* Effect.raceFirst(listening, Effect.raceFirst(Deferred.await(enough), timeout)).pipe(Effect.scoped);
      if (got) return yield* noteRead(s);
      out(`no messages yet. Next: run this command again:\n  ${mcFor(s.alias, s.me)} ${args[0] === "listen" ? "listen --once" : "wait"} --timeout 10m`);
      return 2;
    }),

  watch: () =>
    Effect.gen(function* () {
      const url = opt.webhook ?? (yield* die("usage: kiwi watch --webhook URL [--for-me|--all]"));
      if (!/^https?:\/\//.test(url)) return yield* die("--webhook must be an http(s) URL");
      const secret = opt.secret ?? process.env.KIWI_WEBHOOK_SECRET ?? process.env.MC_WEBHOOK_SECRET;
      const s = yield* session();
      process.stderr.write(`kiwi: watching ${s.alias} as ${s.me}, POSTing to ${url}\n`);
      const headers = { "content-type": "application/json", ...(secret ? { "x-kiwi-secret": secret } : {}) };
      const post = (m: Message, state: ChannelState) =>
        Effect.promise(async () => {
          const body = JSON.stringify({
            channel: s.alias,
            seq: m.seq,
            from: m.from,
            to: m.to ?? null,
            kind: m.kind,
            re: m.re ?? null,
            text: m.kind === "event" ? describeEvent(m, state) : m.body,
            images: m.imgs?.map((i) => i.name) ?? [],
            trust: state.trust.get(m.seq) ?? null,
            ts: m.ts,
          });
          try {
            const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
            if (!res.ok) process.stderr.write(`kiwi: webhook ${res.status} for #${m.seq}\n`);
            return res.ok;
          } catch (err) {
            process.stderr.write(`kiwi: webhook failed for #${m.seq}: ${err instanceof Error ? err.message : err}\n`);
            return false;
          }
        });
      yield* s.listen(post, {
        ...(yield* delivery(s)),
        ...(!opt["for-me"] && opt.thread === undefined ? { chat: true } : {}),
        onStatus: (msg) => Effect.sync(() => void process.stderr.write(`kiwi: ${msg}\n`)),
        onNotice: (text) =>
          Effect.sync(
            () => void fetch(url, { method: "POST", headers, body: JSON.stringify({ channel: s.alias, kind: "notice", text, ts: Date.now() }), signal: AbortSignal.timeout(10_000) }).catch(() => {}),
          ),
      });
    }),
};
