import * as Effect from "effect/Effect";
import { join as joinPath } from "node:path";
import { oneLook } from "../../agent.ts";
import { saveImages } from "../../attach.ts";
import { home } from "../../config.ts";
import { formatShown, missingImages, parseDuration } from "@kiwi/core/format.ts";
import reactionPack from "../../../assets/reactions/index.json";
import {
  CHAT_KINDS,
  CHOICE_MAX_LENGTH,
  CHOICES_MAX,
  CHOICES_MIN,
  HANDOFF_DEFAULT_SECONDS,
  HANDOFF_MAX_SECONDS,
  HANDOFF_MAX_VENDOR,
  handoffUrl,
  ignored,
  wellFormedChoices,
  isGifReaction,
  isQuiet,
  type InlineImage,
  type Kind,
  type Message,
} from "@kiwi/core/protocol.ts";
import { chooseThread, parseTaskId, wentTo } from "@kiwi/core/state.ts";
import { args, opt } from "../args.ts";
import { parseWhere } from "../where.ts";
import { type Command, die, noteRead, offlineOk, out, session } from "../context.ts";
import { images, list, render, text } from "../input.ts";

export const messageCommands: Record<string, Command> = {
  send: () =>
    oneLook(
      Effect.gen(function* () {
        if (opt.escalate) {
          const extra = (["to", "image", "kind", "room", "ask", ...(opt.handoff === undefined ? (["wait"] as const) : [])] as const).filter((f) => opt[f] !== undefined);
          if (extra.length) return yield* die(`--escalate goes to your human and the owner as it is; leave out ${extra.map((f) => `--${f}`).join(", ")}`);
          return yield* messageCommands.escalate!();
        }
        if (opt.handoff !== undefined) return yield* die("--handoff goes with --escalate");
        if (opt.option !== undefined) return yield* die("--option goes with kiwi ask-human");
        const s = yield* session();
        const body = yield* text(1);
        if (!body.trim()) return yield* die("empty message");
        if (opt.dm && opt.to) return yield* die("--dm NAME already says where it goes; leave out --to (or use --to @NAME alone)");
        const where = parseWhere(opt.to);
        if (typeof where === "string") return yield* die(where);
        const { state } = yield* s.state();
        const named = opt.task === undefined ? where.task : (parseTaskId(opt.task) ?? (yield* die(`"${opt.task}" isn't a task id (like T12)`)));
        const dm = opt.dm ?? where.dm;
        const reArgs = [...(list(opt.re) ?? []), ...(where.re ?? []).map(String)];
        const chosen = chooseThread(state, s.me, { ...(named !== undefined ? { task: named } : {}), main: opt.main || where.main, ...(dm ? { dm } : {}), reply: reArgs.length > 0 });
        if (typeof chosen === "string") return yield* die(chosen);
        const to = chosen.to ?? where.to;
        const kind = (opt.kind ?? "msg") as Kind;
        if (!CHAT_KINDS.includes(kind)) return yield* die(`kind must be one of: ${CHAT_KINDS.join(", ")}`);
        const re = reArgs.map((x) => Number(x.replace(/^#/, ""))).filter((n) => n > 0);
        const imgs = yield* images;
        const asking = opt.ask || !!opt.wait;
        const head = asking && opt.wait ? yield* s.ch.fx.head() : 0;
        const seq = yield* s.send(body, {
          to,
          kind: asking && !opt.kind ? "ask" : kind,
          ...(re.length ? { re } : {}),
          imgs,
          room: opt.room ?? where.room,
          ...(chosen.task !== undefined ? { task: chosen.task } : {}),
          ...(chosen.dm ? { dm: true } : {}),
        });
        if (!asking || !opt.wait) return out(`${asking ? "asked" : "sent"} #${seq}${wentTo(chosen)}`);
        const replies = yield* s.awaitReplies(seq, head, parseDuration(opt.wait));
        if (!replies.length) return yield* die(`no answer to #${seq} within ${opt.wait}; replies will still arrive when you listen`, 2);
        for (const r of replies) out(render(r));
      }),
    ),

  ask: () => {
    opt.ask = true;
    if (opt.kind === undefined) opt.kind = "ask";
    return messageCommands.send!();
  },

  reply: () =>
    oneLook(
      Effect.gen(function* () {
        const s = yield* session();
        const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die('usage: kiwi reply N "text"'));
        const body = yield* text(2);
        if (!body.trim()) return yield* die("empty reply");
        const imgs = yield* images;
        out(`sent #${yield* s.reply(seq, body, (opt.kind ?? "msg") as Kind, imgs)}`);
      }),
    ),

  answering: () =>
    oneLook(
      Effect.gen(function* () {
        const s = yield* session();
        const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi answering N"));
        yield* s.answering(seq);
        out(`answering #${seq}: the others leave it to you for 10 minutes`);
      }),
    ),

  react: () =>
    oneLook(
      Effect.gen(function* () {
        if (args[1] === "--list" || opt.list) {
          for (const g of reactionPack) out(`${g.reaction}/${g.name}  ${g.feeling}`);
          return;
        }
        const s = yield* session();
        const usage = "usage: kiwi react N ok/trailer (kiwi react --list shows the GIFs), or an emoji; --clear takes it back";
        const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die(usage));
        const emoji = opt.clear ? null : args[2]?.trim() || (yield* die(usage));
        if (emoji && isGifReaction(emoji) && !reactionPack.some((g) => `${g.reaction}/${g.name}` === emoji)) return yield* die(`no GIF ${emoji}: kiwi react --list shows them`);
        yield* s.react(seq, emoji);
        out(emoji ? `reacted ${emoji} to #${seq}` : `took back your reaction on #${seq}`);
      }),
    ),

  save: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi save N [dir]"));
      const { messages, state } = yield* s.state();
      const found = yield* s.message(seq, messages);
      const m = found && !ignored(state.trust.get(seq)) ? found : yield* die(`no message #${seq}`);
      if (!m.imgs?.length) return yield* die(`message #${seq} has no images`);
      const imgs = yield* s.ch.fx.images(m.imgs);
      if (!imgs.length) return yield* die(`message #${seq}'s images are no longer on the relay`);
      for (const path of saveImages(seq, imgs, args[2] ?? ".")) out(path);
      const missing = missingImages(seq, m.imgs.length, imgs.length);
      if (missing) process.stderr.write(`kiwi: ${missing}\n`);
    }),

  show: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi show N [dir]"));
      const { messages, state } = yield* s.state();
      const found = yield* s.message(seq, messages);
      const m = found && !ignored(state.trust.get(seq)) ? found : yield* die(`no message #${seq}`);
      const root = state.threadOf.get(seq) ?? seq;
      const thread = yield* s.threadMessages(root, messages, state);
      const known = [...messages, ...thread.filter((x) => !messages.some((y) => y.seq === x.seq))];
      const fetched = m.imgs?.length
        ? yield* Effect.forEach(m.imgs, (img) => s.ch.fx.images([img]).pipe(Effect.orElseSucceed((): InlineImage[] => [])), { concurrency: 4 }).pipe(Effect.map((lists) => lists.flat()))
        : [];
      const saved = fetched.length ? saveImages(seq, fetched, args[2] ?? joinPath(home(), "downloads", s.ch.roomId)) : [];
      out(formatShown(m, known, state, saved, s.me, !!opt.reveal && !!m.to?.includes(s.me)));
      const near = new Set([seq, ...(m.re ?? []), ...known.filter((x) => x.re?.includes(seq)).map((x) => x.seq)]);
      const rest = thread.filter((x) => !near.has(x.seq) && !ignored(state.trust.get(x.seq)));
      if (rest.length) {
        out(`the rest of thread #${root}:`);
        for (const x of rest) out(`  ${render(x, state)}`);
      }
      yield* noteRead(s);
    }),

  log: () =>
    offlineOk(
      Effect.gen(function* () {
        const s = yield* session();
        const { messages: held, state } = yield* s.state();
        const room = opt.room === undefined ? undefined : yield* s.roomId(opt.room, state);
        const task = opt.task === undefined ? undefined : (parseTaskId(opt.task) ?? (yield* die(`no task ${opt.task}`)));
        if (task !== undefined && !state.tasks.has(task)) return yield* die(`no task T${task}`);
        const inTask = (m: Message) => {
          const place = state.placeOf.get(m.seq);
          return (place?.kind === "task" && place.task === task) || m.seq === task || (!!m.ev && "task" in m.ev && m.ev.task === task);
        };
        const since = opt.all || task !== undefined || room !== undefined ? 0 : (state.compact?.through ?? 0);
        if (since) out(`(history compacted through #${since}: kiwi compact shows the summary, kiwi log --all everything)`);
        const visible = (m: Message) =>
          m.seq > since &&
          (opt.all || !isQuiet(m)) &&
          !ignored(state.trust.get(m.seq)) &&
          (room === undefined || (m.kind !== "event" && state.roomOf.get(m.seq) === room)) &&
          (task === undefined || inTask(m));
        const shown = (yield* s.earlier(held, Number(opt.n ?? 30), visible)).filter(visible);
        for (const m of shown.slice(-Number(opt.n ?? 30))) out(render(m, state));
      }),
    ),

  thread: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi thread N"));
      const { messages, state } = yield* s.state();
      if (!(yield* s.message(seq, messages))) return yield* die(`no message #${seq}`);
      const root = state.threadOf.get(seq) ?? seq;
      for (const m of yield* s.threadMessages(root, messages, state)) if (!ignored(state.trust.get(m.seq))) out(render(m, state));
    }),

  sh: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const script = (yield* text(1)) || (yield* die("usage: kiwi sh 'SCRIPT' (start with: kiwi sh 'cat README')"));
      const { channelFiles, runSh, sessionViews, channelTables } = yield* Effect.promise(() => import("../../sh.ts"));
      const views = yield* sessionViews(s, script);
      const r = yield* Effect.promise(() => runSh(channelFiles(views), script, { tables: channelTables(views) }));
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      return r.exitCode;
    }),

  "ask-human": () => messageCommands.escalate!(),

  escalate: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const body = yield* text(1);
      if (!body.trim()) return yield* die('usage: kiwi ask-human [--option "A: …" --option "B: …"] [--task T7] [--re N] "the decision you need"');
      const re = opt.re === undefined ? undefined : Number(opt.re.replace(/^#/, "")) || (yield* die("--re takes a message number"));
      const task = opt.task === undefined ? undefined : (parseTaskId(opt.task) ?? (yield* die(`"${opt.task}" isn't a task id (like T12)`)));
      if (opt.handoff === undefined) {
        for (const f of ["vendor", "expires", "wait"] as const) if (opt[f] !== undefined) return yield* die(`--${f} goes with --handoff URL`);
        const choices = opt.option?.map((o) => o.trim());
        if (choices && !wellFormedChoices(choices)) return yield* die(`--option takes ${CHOICES_MIN} to ${CHOICES_MAX} different answers, one line of up to ${CHOICE_MAX_LENGTH} characters each`);
        const { seq, to } = yield* s.escalate(body, re, undefined, { ...(choices ? { choices } : {}), ...(task !== undefined ? { task } : {}) });
        return out(`escalated #${seq} to ${to.join(" and ")}${choices ? ` with ${choices.length} options` : ""}; wait for their answer before acting on it`);
      }
      if (opt.option !== undefined) return yield* die("--handoff has its own Done and Couldn't answers; leave out --option");
      if (!handoffUrl(opt.handoff)) return yield* die("--handoff takes an https link without a user name or password, up to 2048 characters");
      const vendor = opt.vendor ?? new URL(opt.handoff).hostname;
      if (/steel/i.test(vendor) || /(^|\.)steel\.dev$/i.test(new URL(opt.handoff).hostname))
        process.stderr.write("kiwi: steel live links are not authenticated; anyone with the link can use the tab\n");
      const seconds = opt.expires === undefined ? HANDOFF_DEFAULT_SECONDS : parseDuration(opt.expires);
      if (seconds < 1 || seconds > HANDOFF_MAX_SECONDS) return yield* die(`--expires must be between 1s and ${HANDOFF_MAX_SECONDS / 60}m`);
      const expiresAt = Date.now() + seconds * 1000;
      const head = opt.wait === undefined ? 0 : yield* s.ch.fx.head();
      const { seq, to } = yield* s.escalate(body, re, { url: opt.handoff, vendor: vendor.slice(0, HANDOFF_MAX_VENDOR), expiresAt }, task !== undefined ? { task } : {});
      out(`escalated #${seq} to ${to.join(" and ")} with a browser link that opens for ${opt.expires ?? "10m"}; wait for their answer before acting on it`);
      if (opt.wait === undefined) return;
      const { outcome, replies } = yield* s.awaitHandoff(seq, head, expiresAt, parseDuration(opt.wait));
      for (const r of replies) out(render(r));
      if (outcome === "done") return;
      if (outcome === "waiting") return yield* die(`no answer to the handoff #${seq} within ${opt.wait}; the link is still open, so replies will still arrive when you listen`, 2);
      return yield* die(outcome === "failed" ? `the person couldn't finish the handoff #${seq}` : `no answer to the handoff #${seq} before it expired`, 4);
    }),
};
