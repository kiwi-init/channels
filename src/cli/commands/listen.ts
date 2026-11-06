import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { ago, describeEvent, parseDuration } from "@kiwi/core/format.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import type { AgentSession } from "../../agent.ts";
import { COMMANDS } from "../../brief.ts";
import { mcFor } from "../../hooks.ts";
import { listenMode, wokenBy, type ListenMode } from "../../hooks/reach.ts";
import { detectCard } from "../../card.ts";
import { loadConfig } from "../../config.ts";
import { daemonListeners, wakeHooked, wakeOn } from "../../daemon.ts";
import { here } from "../../seats.ts";
import { opt } from "../args.ts";
import { type Command, die, noteRead, out, session } from "../context.ts";
import { delivery, render } from "../input.ts";
import { docWakeLine } from "../../agent/docs.ts";
import { pendingDocWakes, tellDocWakes } from "../../config/doc-wakes.ts";

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

const DOC_POLL_MS = 1_000;

const handDocs = (s: AgentSession): number => {
  const docs = pendingDocWakes(s.alias, s.me);
  for (const w of docs) out(docWakeLine(w, mcFor(s.alias, s.me)));
  tellDocWakes(
    s.alias,
    s.me,
    docs.map((w) => w.block),
  );
  return docs.length;
};

const pollDocs = (s: AgentSession, handed: Effect.Effect<void, never, Scope.Scope>) =>
  Effect.forever(
    Effect.andThen(
      Effect.suspend(() => (handDocs(s) ? handed : Effect.void)),
      Effect.sleep(DOC_POLL_MS),
    ),
  );

const readFrom = (s: AgentSession) =>
  Effect.gen(function* () {
    const { messages, state } = yield* s.read(yield* delivery(s));
    for (const m of messages) out(render(m, state));
    const docs = handDocs(s);
    if (!messages.length && !docs) process.stderr.write(`${yield* nothingUnread(s.alias, s.me)}\n`);
    yield* noteRead(s);
  });

const tailFrom = (s: AgentSession) =>
  Effect.gen(function* () {
    yield* Effect.forkDetach(Effect.ignoreCause(s.refreshCard(detectCard())));
    yield* Effect.forkScoped(pollDocs(s, Effect.void));
    yield* s.listen((m, state) => Effect.sync(() => out(render(m, state))), {
      ...(yield* delivery(s)),
      onStatus: (msg) => Effect.sync(() => void process.stderr.write(`kiwi: ${msg}\n`)),
      onNotice: (text) => Effect.sync(() => out(`* ${text}`)),
    });
  }).pipe(Effect.scoped);

const waitFrom = (s: AgentSession, wait: string | undefined) =>
  Effect.gen(function* () {
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
    const timeout = wait ? Effect.sleep(parseDuration(wait) * 1000) : Effect.never;
    const hearing = Effect.raceFirst(listening, pollDocs(s, woke));
    yield* Effect.raceFirst(hearing, Effect.raceFirst(Deferred.await(enough), timeout)).pipe(Effect.scoped);
    if (got) return yield* noteRead(s);
    out(`no messages yet. Next: run this command again:\n  ${mcFor(s.alias, s.me)} listen --once --timeout 10m`);
    return 2;
  });

const waking = (s: AgentSession) => {
  const cfg = loadConfig();
  return { on: wakeOn(cfg, s.alias, s.me), webhook: wakeHooked(cfg, s.alias, s.me) };
};

export const modeFor = (s: AgentSession): ListenMode => {
  const w = waking(s);
  return listenMode(w.on, here(), w.webhook);
};

export const listenAs = (s: AgentSession, mode: ListenMode) => (mode === "read" ? readFrom(s) : mode === "once" ? waitFrom(s, undefined) : tailFrom(s));

const listenerRefused = (s: AgentSession) =>
  Effect.gen(function* () {
    const w = waking(s);
    const by = here().harness ? wokenBy(w.on, here(), w.webhook) : null;
    if (!by) return;
    return yield* die(`Kiwi already wakes you in this session (${by}), and a listener of yours would take its place. Run \`${COMMANDS.join(mcFor(s.alias, s.me))}\` to read what's waiting.`, 2);
  });

const once = () =>
  Effect.gen(function* () {
    const s = yield* session();
    if (!opt.timeout) yield* listenerRefused(s);
    return yield* waitFrom(s, opt.timeout);
  });

const toWebhook = (url: string) =>
  Effect.gen(function* () {
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
          files: m.files?.map((f) => f.name) ?? [],
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
  });

export const listenCommands: Record<string, Command> = {
  listen: () => {
    if (opt.now && (opt.once || opt.timeout)) return die("--now doesn't wait: leave out --once and --timeout");
    if (opt.webhook) return toWebhook(opt.webhook);
    if (opt.now) return Effect.flatMap(session(), readFrom);
    if (opt.once || opt.timeout) return once();
    return Effect.gen(function* () {
      const s = yield* session();
      if (!here().harness) return yield* tailFrom(s);
      const w = waking(s);
      if (wokenBy(w.on, here(), w.webhook)) return yield* readFrom(s);
      return yield* modeFor(s) === "once" ? waitFrom(s, undefined) : tailFrom(s);
    });
  },
};
