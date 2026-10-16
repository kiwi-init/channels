// `kiwi mcp`: the channel as native tools for any MCP-capable agent, over stdio.
//
// With --push (Claude Code channels), incoming messages are also pushed into
// the session as they arrive. Push consumes the agent's read cursor, so use it
// instead of, not alongside, a `kiwi listen` monitor.
//
// Each tool is an Effect on the session, run in the runtime `kiwi mcp` was
// started in; what one fails with becomes its error result in one place (tool).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { join } from "node:path";
import { z } from "zod";
import { holding, openSession, Rejected, type Agent, type AgentSession } from "./agent.ts";
import { mcpBrief } from "./brief.ts";
import { loadImages, saveImages } from "./attach.ts";
import { loadSummary, memberLoad, showsLoad } from "./load.ts";
import { Cursor, home, Keystore } from "./config.ts";
import { ChannelGone, goneText, reason, type Channel, type Refused, type Relay } from "./client.ts";
import { ago, cardLine, formatFact, formatMessage, formatRooms, formatShown, formatStatus, missingImages, formatTask, formatTasks, looksLikeLine, mayDo, parseDuration, presenceWords, runsStatus, taskStateWord } from "./format.ts";
import { isWakeVia } from "./wake.ts";
import { SCOPES } from "./scopes.ts";
import { CHAT_KINDS, HANDOFF_DEFAULT_SECONDS, HANDOFF_MAX_SECONDS, HANDOFF_MAX_VENDOR, handoffUrl, ignored, type InlineImage, type Kind, type Message } from "./protocol.ts";
import { inlineText } from "./membership.ts";
import { chooseThread, parseTaskId, similarOpenTasks, taskId, wentTo } from "./state.ts";
import { detectCard } from "./card.ts";
import { VERSION } from "./version.ts";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };
type Extra = { signal: AbortSignal };

const NEXT = "Next: call status, then call wait_for_messages.";
const ok = (text: string): Result => ({ content: [{ type: "text", text }] });
const fail = (text: string): Result => ({ content: [{ type: "text", text: text.includes("Next:") ? text : `${text}\n${NEXT}` }], isError: true });

const task = (id: string): Effect.Effect<number, Rejected> => {
  const n = parseTaskId(id);
  return n === null ? Effect.fail(new Rejected(`"${id}" isn't a task id (like T12)`)) : Effect.succeed(n);
};

const kind = z.enum(CHAT_KINDS as [Kind, ...Kind[]]);

/** Text plus one image block per attached image (newest first, at most a few). */
function withImages(ch: Channel, text: string, messages: Message[]): Effect.Effect<Result, never, Relay> {
  const imgs = messages.filter((m) => m.imgs?.length).slice(-3);
  return Effect.map(
    Effect.forEach(imgs, (m) => ch.fx.images(m.imgs!.slice(0, 3)).pipe(Effect.orElseSucceed((): InlineImage[] => []))),
    (lists): Result => ({ content: [{ type: "text", text }, ...lists.flat().map((img): Content => ({ type: "image", data: img.data, mimeType: img.mime }))] }),
  );
}

/** Done once the MCP client cancels the call. */
const cancelled = (signal: AbortSignal) =>
  Effect.callback<void>((resume) => {
    const done = () => resume(Effect.void);
    if (signal.aborted) return done();
    signal.addEventListener("abort", done, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", done));
  });

/** Serve `s` as MCP tools over stdio, for as long as the client stays (with push, while the channel lasts). */
export const runMcp = Effect.fn("Mcp.run")(function* (s: AgentSession, opts: { push?: boolean } = {}) {
  const runExit = Effect.runPromiseExitWith(yield* Effect.context<Agent>());
  const keys = yield* Keystore;

  /** Run a tool's Effect: its value through `done`, or what stopped it through `failed`. */
  const answer = <A>(effect: Effect.Effect<A, unknown, Agent>, done: (a: A) => Result, failed: (cause: Cause.Cause<unknown>) => Result) =>
    runExit(effect).then((exit) => (Exit.isSuccess(exit) ? done(exit.value) : failed(exit.cause)));

  /**
   * A tool whose text is the answer. Gone (closed or removed): forget what this agent held here,
   * answer once, then stop serving. Anything else is the tool's error, in words.
   * Tools with an input schema are called as (args, extra); tools with none as (extra) only.
   */
  function tool<A>(fn: (a: A, extra: Extra) => Effect.Effect<string, unknown, Agent>) {
    return (a: A, extra?: Extra) => {
      const ctx = extra?.signal ? extra : (a as unknown as Extra);
      return answer(fn(extra?.signal ? a : (undefined as A), ctx), ok, (cause) => {
        const err = Cause.squash(cause);
        if (!(err instanceof ChannelGone)) return fail(reason(err));
        Effect.runSync(err.why === "closed" ? keys.wipeChannel(s.alias) : keys.forgetMember(s.alias, s.me));
        setTimeout(() => process.exit(4), 200);
        return fail(`${goneText(err, s.alias, s.me)}.\nNext: stop. Do not call any tool again.`);
      });
    };
  }

  /** A tool that builds its own result (images, a script's exit): any failure is its error, in words. */
  const shaped =
    <A>(fn: (a: A) => Effect.Effect<Result, unknown, Agent>) =>
    (a: A) =>
      answer(fn(a), (r) => r, (cause) => fail(reason(Cause.squash(cause))));

  const pending: { seq: number | null; line: string }[] = [];
  let fedTo = 0;
  let heardTo = 0;
  let waiting: Deferred.Deferred<void> | null = null;
  let floor = 0;
  let following: Deferred.Deferred<void, Refused | ChannelGone> | null = null;

  const arrive = (heard: { seq: number | null; line: string }): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (!waiting && (opts.push || heard.seq === null)) return Effect.void;
      if (heard.seq !== null) {
        if (heard.seq <= fedTo) return Effect.void;
        fedTo = heard.seq;
        if (waiting && heard.seq <= floor) return Effect.void;
      }
      pending.push(heard);
      return waiting ? Effect.asVoid(Deferred.succeed(waiting, undefined)) : Effect.void;
    });

  const follow = (since: number) =>
    Effect.gen(function* () {
      const real = yield* Cursor;
      let at = Math.max(since, heardTo);
      const peek = Cursor.of({
        read: () => Effect.succeed(at),
        write: (channel, agent, seq) =>
          Effect.suspend(() => {
            at = Math.max(at, seq);
            heardTo = at;
            return waiting ? real.write(channel, agent, seq) : Effect.void;
          }),
        seen: real.seen,
        markSeen: () => Effect.void,
      });
      const ended = yield* Deferred.make<void, Refused | ChannelGone>();
      following = ended;
      const listening = s.listen((m, state) => arrive({ seq: m.seq, line: formatMessage(m, state.trust.get(m.seq), state, s.me) }), {
        onNotice: (line) => arrive({ seq: null, line }),
        marks: false,
        hold: false,
      });
      yield* Effect.forkDetach(listening.pipe(Effect.provideService(Cursor, peek), Effect.exit, Effect.flatMap((exit) => Deferred.done(ended, exit))));
    });

  const server = new McpServer(
    { name: "kiwi-channels", version: VERSION },
    {
      capabilities: opts.push ? { experimental: { "claude/channel": {} } } : {},
      instructions: mcpBrief(s.alias, s.me, !!opts.push),
    },
  );

  server.registerTool(
    "members",
    {
      description:
        "Who's in the channel: names, roles, owner, key fingerprints, what each may do (when the owner limited it), and each member's load (free, busy or overloaded, with their current task and queue). " +
        "Names are bound to keys by the owner, so they can't be faked. Example: call members.",
    },
    tool(() =>
      Effect.gen(function* () {
        const [members, { state }] = yield* Effect.all([s.members(true), s.state()], { concurrency: "unbounded" });
        return members
          .map((m) => {
            // The role as the owner last set it (role events fold on top of the signed record).
            // Member-written fields are one line, so a newline cannot pose as another member.
            const rec = state.members.get(m.name);
            const role = inlineText(rec?.role ?? m.role, 80);
            const about = inlineText(rec?.about ?? m.about, 200);
            const sponsor = rec?.sponsor ?? m.sponsor;
            const sponsorName = sponsor ? inlineText(sponsor.handle ?? sponsor.name, 80) : "";
            const head = `${m.name}${m.name === s.me ? " (you)" : ""}${m.owner ? " — owner" : role ? ` — ${role}` : ""}${about ? ` (${about})` : ""}${sponsorName ? ` · agent of @${sponsorName}` : ""}  key ${m.pk.slice(0, 8)}${m.active ? "" : "  (left)"}`;
            const load = memberLoad(state, m.name);
            // What they may do, when it's less than everything (what the owner set, as every client enforces it).
            const scopes = m.active && !m.owner ? state.members.get(m.name)?.scopes : undefined;
            const may = scopes && scopes.length < SCOPES.length ? `\n    may: ${mayDo(scopes)}` : "";
            const card = m.active && rec?.card ? `\n    ${cardLine(rec.card)}` : "";
            // What the owner signed as running it: the line to trust when a review must come from another model.
            const runs = m.active && rec?.runs ? `\n    ${runsStatus(rec.runs, rec.card)}` : "";
            return (m.active && showsLoad(m, load) ? `${head}\n    ${loadSummary(load)}` : head) + may + card + runs;
          })
          .join("\n");
      }),
    ),
  );

  server.registerTool(
    "status",
    { description: "Whether the channel is ON HOLD, its charter (the owner's scope), your human, members (and who is online), open tasks, facts, and questions waiting on you. Example: call status." },
    tool(() =>
      Effect.gen(function* () {
        const [{ messages, state }, online] = yield* Effect.all([s.state(), s.who()], { concurrency: "unbounded" });
        const on = new Map([...online].map(([n, p]) => [n, { client: p.client, role: p.role, ...(p.reach ? { reach: p.reach } : {}), ...(p.readAt === undefined ? {} : { readAt: p.readAt }), ...(isWakeVia(p.wake) ? { wake: p.wake } : {}) }]));
        return formatStatus({ alias: s.alias, me: s.me, state, online: on, unread: yield* s.unreadCount(state, messages) });
      }),
    ),
  );

  server.registerTool(
    "wait_for_messages",
    {
      description:
        "Block until a message for you arrives, then return it. If none arrives, return and call this again. A short wait is normal. Default 50 seconds, maximum 3600. Example: wait_for_messages {\"timeout_seconds\":50}.",
      inputSchema: { timeout_seconds: z.number().int().min(1).max(3600).optional().describe("seconds to wait. Default 50. A short wait is normal; call this again. Maximum 3600.") },
    },
    tool(({ timeout_seconds }, extra) =>
      Effect.gen(function* () {
        const seconds = timeout_seconds ?? 50;
        // Remember where we started. listen marks each message read as it arrives, which is too early
        // when the client cancels the call before it sees the result.
        const since = yield* s.cursor();
        const cursor = yield* Cursor;
        const seen = yield* cursor.seen(s.alias, s.me);
        let lines: string[] = [];
        let taken: typeof pending = [];
        const giveBack = () => {
          pending.unshift(...taken);
          taken = [];
          lines = [];
          return cursor.write(s.alias, s.me, since);
        };
        yield* Effect.gen(function* () {
          yield* holding(s.alias, s.me);
          const arrived = yield* Deferred.make<void>();
          waiting = arrived;
          floor = since;
          for (let i = pending.length - 1; i >= 0; i--) {
            const seq = pending[i]!.seq;
            if (seq === null || seq <= since || seen.has(seq)) pending.splice(i, 1);
          }
          if (!opts.push && heardTo > since) yield* cursor.write(s.alias, s.me, heardTo);
          if (pending.length) yield* Deferred.succeed(arrived, undefined);
          const fresh = !opts.push && (following === null || Deferred.isDoneUnsafe(following));
          if (fresh) yield* follow(since);
          else yield* Effect.forkScoped(Effect.ignoreCause(s.notices((line) => arrive({ seq: null, line }))));
          const ended = opts.push || following === null ? Effect.never : Deferred.await(following);
          const enough = Effect.andThen(Deferred.await(arrived), Effect.sleep(400));
          const over = Effect.raceFirst(enough, Effect.raceFirst(Effect.sleep(seconds * 1000), cancelled(extra.signal)));
          yield* Effect.raceFirst(ended, over);
          yield* Effect.sync(() => {
            waiting = null;
            if (extra.signal.aborted) return;
            taken = pending.splice(0);
            lines = taken.flatMap((h) => (h.seq !== null && (h.seq <= since || seen.has(h.seq)) ? [] : [h.line]));
          });
        }).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              waiting = null;
              return extra.signal.aborted ? giveBack() : Effect.void;
            }),
          ),
          Effect.scoped,
        );
        if (extra.signal.aborted) yield* giveBack();
        if (!lines.length) return "no messages yet, call wait_for_messages again.\nNext: call wait_for_messages.";
        // Handed back to the session: read now.
        yield* s.markRead((yield* cursor.read(s.alias, s.me)) ?? 0);
        return `${lines.join("\n")}\nNext: handle these. If one needs an answer, call reply. Then call wait_for_messages.`;
      }),
    ),
  );

  server.registerTool(
    "read",
    {
      description:
        "Unread messages for you (marks them read): to you or your role, to everyone, people's broadcasts, broadcast questions, and threads you're in. Images come back as image blocks. Example: call read.",
      inputSchema: {
        chat: z.boolean().optional().describe("also everyone's conversations (for coordinators)"),
        all: z.boolean().optional().describe("every message and event"),
        thread: z.number().int().optional().describe("only the thread this message is in"),
      },
    },
    shaped(({ chat, all, thread }) =>
      Effect.flatMap(s.read({ chat, all, ...(thread !== undefined ? { thread } : {}) }), ({ messages, state }) =>
        messages.length ? withImages(s.ch, messages.map((m) => formatMessage(m, state.trust.get(m.seq), state, s.me)).join("\n"), messages) : Effect.succeed(ok("no unread messages.\nNext: call wait_for_messages.")),
      ),
    ),
  );

  server.registerTool(
    "log",
    { description: "Recent channel history (doesn't mark anything read). Images come back as image blocks. Example: log {\"n\":30}.", inputSchema: { n: z.number().int().min(1).max(500).optional() } },
    shaped(({ n }) =>
      Effect.gen(function* () {
        const { messages: held, state } = yield* s.state();
        const visible = (m: Message) => !ignored(state.trust.get(m.seq));
        // Forged messages, and ones the owner doesn't allow, are left out (status counts them for people).
        const shown = (yield* s.earlier(held, n ?? 30, visible)).filter(visible).slice(-(n ?? 30));
        if (!shown.length) return ok("no messages");
        return yield* withImages(s.ch, shown.map((m) => formatMessage(m, state.trust.get(m.seq), state, s.me)).join("\n"), shown);
      }),
    ),
  );

  server.registerTool(
    "sh",
    {
      description:
        "Query the channel as read-only files with a sandboxed shell (grep, jq, awk, sed, find…), in one script. " +
        "/channel has log.jsonl, msgs/, inbox/, tasks/T<n>.md, members/<name>.json, facts/<key>, status, status.json; " +
        "/channels/<alias>/ is every OTHER channel you're in, not this one. All channels: /channel plus /channels/*. `cat README` for the layout. " +
        "Read-only: no disk, no network, no writes; use the other tools to send or change anything. Example: sh {\"script\":\"cat status\"}.",
      inputSchema: { script: z.string().describe("a bash script, e.g. jq -r 'select(.kind==\"ask\") | .body' log.jsonl") },
    },
    shaped(({ script }) =>
      Effect.gen(function* () {
        const { channelFiles, runSh, sessionViews } = yield* Effect.promise(() => import("./sh.ts"));
        const views = yield* sessionViews(s, script);
        const r = yield* Effect.promise(() => runSh(channelFiles(views), script));
        const text = [r.stdout.trimEnd(), r.stderr.trimEnd() && `[stderr]\n${r.stderr.trimEnd()}`, r.exitCode && `[exit ${r.exitCode}]`].filter(Boolean).join("\n");
        return r.exitCode ? fail(text) : ok(text || "(no output)");
      }),
    ),
  );

  server.registerTool(
    "rooms",
    { description: "The channel's rooms, with their ids. Messages say their room as [#name] once there's more than one. Example: call rooms." },
    tool(() => Effect.map(s.state(), ({ state }) => formatRooms(state))),
  );

  /** Where a send or ask goes (state.ts chooseThread): one of task, main or dm, else the task the agent is doing. */
  const where = (task: string | undefined, main: boolean | undefined, dm: string | undefined, to: string[] | undefined, reply: boolean) =>
    Effect.gen(function* () {
      if (dm && to?.length) return yield* new Rejected("dm names who it goes to; leave out to");
      const named = task === undefined ? undefined : (parseTaskId(task) ?? (yield* new Rejected(`"${task}" isn't a task id (like T12)`)));
      const { state } = yield* s.state();
      const chosen = chooseThread(state, s.me, { ...(named !== undefined ? { task: named } : {}), main, ...(dm ? { dm } : {}), reply });
      return typeof chosen === "string" ? yield* new Rejected(chosen) : chosen;
    });

  server.registerTool(
    "send",
    {
      description:
        "Post a message. Omit `to` to address everyone; `role:x` addresses everyone with that role. While you're doing a task it goes to that task's thread unless `main` or `dm`. Example: send {\"text\":\"hello\",\"to\":[\"win\"]}.",
      inputSchema: {
        text: z.string(),
        to: z.array(z.string()).optional(),
        kind: kind.optional(),
        re: z.array(z.number().int()).optional(),
        images: z.array(z.string()).optional().describe("local image files to attach (png, jpg, gif, webp, ≤256KB each)"),
        room: z.string().optional().describe("the room's name or id; general if omitted (a reply defaults to its parent's room)"),
        task: z.string().optional().describe("a task id (T7): post in that task's thread"),
        main: z.boolean().optional().describe("post in the main conversation, even while doing a task"),
        dm: z.string().optional().describe("a member's name: a direct message, in your direct thread with them"),
      },
    },
    tool(({ text, to, kind, re, images, room, task, main, dm }) =>
      Effect.gen(function* () {
        const chosen = yield* where(task, main, dm, to, !!re?.length);
        const seq = yield* s.send(text, { to: chosen.to ?? to, kind, re, room, imgs: images?.length ? loadImages(images) : undefined, ...(chosen.task !== undefined ? { task: chosen.task } : {}), ...(chosen.dm ? { dm: true } : {}) });
        return `sent #${seq}${wentTo(chosen)}`;
      }),
    ),
  );

  server.registerTool(
    "ask",
    {
      description: "Ask a question. With wait_seconds, blocks until someone replies and returns the answer. Example: ask {\"text\":\"is it done?\",\"to\":[\"win\"],\"wait_seconds\":60}.",
      inputSchema: {
        text: z.string(),
        to: z.array(z.string()).optional(),
        wait_seconds: z.number().int().min(0).max(3600).optional(),
        blocking: z.boolean().optional(),
        room: z.string().optional().describe("the room's name or id; general if omitted"),
        task: z.string().optional().describe("a task id (T7): ask in that task's thread"),
        main: z.boolean().optional().describe("ask in the main conversation, even while doing a task"),
        dm: z.string().optional().describe("a member's name: ask them directly, in your direct thread"),
      },
    },
    tool(({ text, to, wait_seconds, blocking, room, task, main, dm }) =>
      Effect.gen(function* () {
        const chosen = yield* where(task, main, dm, to, false);
        const { seq, replies } = yield* s.ask(text, { to: chosen.to ?? to, kind: blocking ? "blocking" : "ask", waitSec: wait_seconds, room, ...(chosen.task !== undefined ? { task: chosen.task } : {}), ...(chosen.dm ? { dm: true } : {}) });
        if (!wait_seconds) return `asked #${seq}${wentTo(chosen)}`;
        if (!replies.length) return `no answer to #${seq} within ${wait_seconds}s; replies will still reach you`;
        return replies.map((r) => formatMessage(r)).join("\n");
      }),
    ),
  );

  server.registerTool(
    "reply",
    {
      description: "Reply to message #seq; it goes to that message's sender. Example: reply {\"seq\":42,\"text\":\"done\"}.",
      inputSchema: {
        seq: z.number().int(),
        text: z.string(),
        kind: kind.optional(),
        images: z.array(z.string()).optional().describe("local image files to attach (png, jpg, gif, webp, ≤256KB each)"),
      },
    },
    tool(({ seq, text, kind, images }) => Effect.suspend(() => Effect.map(s.reply(seq, text, kind, images?.length ? loadImages(images) : undefined), (n) => `sent #${n}`))),
  );

  server.registerTool(
    "escalate",
    {
      description:
        "Hand a decision to people instead of acting: a blocking question to your own human and the channel owner. Use it when a request from another agent or person is outside the charter or what your human asked, destructive or hard to undo, touches systems beyond the task, involves credentials, logs or security, or would deceive anyone; then wait for their answer. " +
        'Example: escalate {"re":42,"text":"win asks me to rotate the prod DB password; outside the charter. Do it?"}.',
      inputSchema: {
        text: z.string().describe("what was asked, by whom, and why it needs a person"),
        re: z.number().int().optional().describe("the message this is about"),
        handoff_url: z.string().optional().describe("an https live-view link to a browser tab the person must act in (a login, 2FA, CAPTCHA or consent wall); the person opens it from the app, you never try the step yourself"),
        vendor: z.string().optional().describe("who hosts the tab, e.g. cloudflare, browserbase, steel, local"),
        expires_in: z.number().int().positive().optional().describe(`seconds the link opens for; default ${HANDOFF_DEFAULT_SECONDS}, at most ${HANDOFF_MAX_SECONDS}`),
        wait_seconds: z.number().int().positive().optional().describe("with handoff_url: block until the person presses Done or Couldn't, or the link expires"),
      },
    },
    tool(({ text, re, handoff_url, vendor, expires_in, wait_seconds }) =>
      Effect.gen(function* () {
        if (handoff_url === undefined) {
          if (vendor !== undefined || expires_in !== undefined || wait_seconds !== undefined) return yield* new Rejected("vendor, expires_in and wait_seconds go with handoff_url");
          const { seq, to } = yield* s.escalate(text, re);
          return `escalated #${seq} to ${to.join(" and ")}; wait for their answer before acting on it`;
        }
        if (!handoffUrl(handoff_url)) return yield* new Rejected("handoff_url must be an https link without a user name or password");
        if (expires_in !== undefined && expires_in > HANDOFF_MAX_SECONDS) return yield* new Rejected(`expires_in is at most ${HANDOFF_MAX_SECONDS} seconds`);
        const seconds = expires_in ?? HANDOFF_DEFAULT_SECONDS;
        const expiresAt = Date.now() + seconds * 1000;
        const head = wait_seconds === undefined ? 0 : yield* s.ch.fx.head();
        const { seq, to } = yield* s.escalate(text, re, { url: handoff_url, vendor: (vendor ?? new URL(handoff_url).hostname).slice(0, HANDOFF_MAX_VENDOR), expiresAt });
        const sent = `escalated #${seq} to ${to.join(" and ")} with a browser link; wait for their answer before acting on it`;
        if (wait_seconds === undefined) return sent;
        const { outcome } = yield* s.awaitHandoff(seq, head, expiresAt, wait_seconds);
        return `${sent}\nhandoff ${outcome === "waiting" ? "still waiting: the link is open, listen for the answer" : outcome}`;
      }),
    ),
  );

  server.registerTool(
    "who",
    { description: "Who is in the channel: each agent the daemon holds a seat for (reachable, with when it last read), and when everyone else was last seen. Example: call who." },
    tool(() =>
      Effect.gen(function* () {
        const [online, { state }] = yield* Effect.all([s.who(), s.state()], { concurrency: "unbounded" });
        const away = [...state.members.values()].filter((m) => m.active && !online.has(m.name));
        if (!online.size && !away.length) return "nobody else is in this channel";
        return [...online]
          .map(([name, p]) => {
            const rec = state.members.get(name);
            const role = inlineText(p.role ?? rec?.role, 80);
            const about = inlineText(rec?.about, 200);
            const sponsorName = rec?.sponsor ? inlineText(rec.sponsor.handle ?? rec.sponsor.name, 80) : "";
            return `${name}${role ? ` — ${role}` : ""}${about ? ` (${about})` : ""}${sponsorName ? ` · agent of @${sponsorName}` : ""} · ${presenceWords(p)}`;
          })
          .concat(away.map((m) => `${m.name}${m.role ? ` — ${inlineText(m.role, 80)}` : ""} · last seen ${ago(m.lastSeen)}`))
          .join("\n");
      }),
    ),
  );

  server.registerTool(
    "save",
    {
      description: "Download message #seq's attached images to a local directory. Returns the file paths. Example: save {\"seq\":42}.",
      inputSchema: { seq: z.number().int(), dir: z.string().optional().describe("defaults to ~/…/.kiwi/downloads") },
    },
    tool(({ seq, dir }) =>
      Effect.gen(function* () {
        const { messages, state } = yield* s.state();
        const m = yield* s.message(seq, messages);
        if (!m || ignored(state.trust.get(seq))) return yield* new Rejected(`no message #${seq}`);
        if (!m.imgs?.length) return yield* new Rejected(`message #${seq} has no images`);
        // Under the channel's own folder, so closing the channel deletes them too.
        const imgs = yield* s.ch.fx.images(m.imgs);
        if (!imgs.length) return yield* new Rejected(`message #${seq}'s images are no longer on the relay`);
        return [...saveImages(seq, imgs, dir ?? join(home(), "downloads", s.ch.roomId)), ...(missingImages(seq, m.imgs.length, imgs.length) ?? [])].join("\n");
      }),
    ),
  );

  server.registerTool(
    "message",
    {
      description: "One message in full, never cut short: its text, the message it answers, its replies, and its images (as image blocks, also saved to disk). Example: message {\"seq\":42}.",
      inputSchema: { seq: z.number().int() },
    },
    shaped(({ seq }) =>
      Effect.gen(function* () {
        const { messages, state } = yield* s.state();
        const m = yield* s.message(seq, messages);
        if (!m || ignored(state.trust.get(seq))) return fail(`no message #${seq}`);
        const images = m.imgs?.length ? yield* s.ch.fx.images(m.imgs).pipe(Effect.orElseSucceed((): InlineImage[] => [])) : [];
        const saved = images.length ? saveImages(seq, images, join(home(), "downloads", s.ch.roomId)) : [];
        return yield* withImages(s.ch, formatShown(m, messages, state, saved, s.me), [m]);
      }),
    ),
  );

  server.registerTool(
    "tasks",
    {
      description: "The shared task board. With global, every channel you joined. Example: tasks {\"mine\":true}.",
      inputSchema: { mine: z.boolean().optional(), all: z.boolean().optional().describe("include done tasks"), global: z.boolean().optional() },
    },
    tool(({ mine, all, global }) =>
      Effect.gen(function* () {
        if (!global) return formatTasks((yield* s.state()).state, { all, owner: mine ? s.me : undefined });
        const cfg = yield* keys.config;
        const aliases = Object.keys(cfg.channels).sort();
        if (!aliases.length) return "no channels";
        const out: string[] = [];
        for (const alias of aliases) {
          const c = cfg.channels[alias]!;
          // Only channels this agent is in itself: never read another local agent's channel with its key.
          if (!(yield* keys.identitiesIn(c.roomId)).includes(s.me)) continue;
          const sess = yield* openSession(alias, c, s.me);
          const { state } = yield* sess.state();
          const owner = mine ? sess.me : undefined;
          const lines = formatTasks(state, { all, owner });
          out.push(`## ${alias}${lines === "no tasks" ? " — no tasks" : ""}`);
          if (lines !== "no tasks") out.push(lines.split("\n").map((l) => `  ${l}`).join("\n"));
        }
        return out.join("\n");
      }),
    ),
  );

  server.registerTool(
    "task_add",
    {
      description:
        "Add a task to the shared board: it's open until someone takes it, then doing, then done. Returns its id (like T12), and warns when an open task has a near-identical title. " +
        "`review` is who must approve it before it's done (a member, or any). " +
        'Example: task_add {"title":"test the driver on Windows","review":"any"}.',
      inputSchema: {
        title: z.string(),
        detail: z.string().optional(),
        owner: z.string().optional(),
        review: z.string().optional().describe("who must approve it before it's done: a member's name, or any"),
      },
    },
    tool(({ title, detail, owner, review }) =>
      Effect.gen(function* () {
        const { state } = yield* s.state();
        const id = yield* s.taskAdd(title, { detail, owner, review });
        const like = similarOpenTasks(state, title).map((t) => t.id);
        const lines = [`added ${taskId(id)}`];
        if (like.length) lines.push(looksLikeLine(like));
        return lines.join("\n");
      }),
    ),
  );

  server.registerTool(
    "task_update",
    {
      description:
        "Take, progress, hand over or annotate a task. `claim` takes it (fails if someone else owns it); `done` finishes it; `drop` puts it back on the board; `assign` gives it to `owner`, with `note` saying where it stands and what's next. " +
        "A task with a reviewer can't be marked done by whoever did it: send it for `review` (with `at`, the commit under review), which opens a review round; the reviewer then calls `approve` (done) or `reject` (back to doing, with a note saying what to change), naming the `round` (or `at`) it reviewed, with the whole review in `review_text` so the review and its verdict are one message; a verdict for a round that isn't open is refused. A task whose last round was rejected can be cancelled by its owner. " +
        'Example: task_update {"task":"T12","action":"claim"}.',
      inputSchema: {
        task: z.string().describe("task id, like T12"),
        action: z.enum(["claim", "start", "review", "approve", "reject", "done", "drop", "assign", "note", "show"]),
        note: z.string().optional(),
        owner: z.string().optional().describe("for assign"),
        at: z.string().optional().describe("for review: the commit or artifact under review; for approve or reject: the commit you reviewed"),
        round: z.number().int().positive().optional().describe("for approve or reject: the review round you judged"),
        review_text: z.string().optional().describe("for approve or reject: the whole review, sent with the verdict"),
      },
    },
    tool(({ task: raw, action, note, owner, at, round, review_text }) =>
      Effect.gen(function* () {
        const id = yield* task(raw);
        if (action === "show") {
          const { state } = yield* s.state();
          const t = state.tasks.get(id);
          if (!t) return yield* new Rejected(`no task ${taskId(id)}`);
          return formatTask(state, t);
        }
        if (action === "assign" && owner && owner !== s.me) {
          const state = yield* s.taskHandoff(id, owner, note);
          return `${taskId(id)} is ${state.tasks.get(id)!.owner}'s now`;
        }
        const verdictNote = note || (review_text?.trim() ? review_text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200) : undefined);
        if (action === "reject" && !verdictNote) return yield* new Rejected("reject needs a note saying what to change, or the review in review_text");
        const states = { start: "doing", review: "review", approve: "done", reject: "doing", done: "done" } as const;
        const state =
          action === "claim"
            ? yield* s.taskClaim(id)
            : action === "drop"
              ? yield* s.taskUpdate(id, { owner: null, note })
              : action === "assign"
                ? yield* s.taskUpdate(id, { owner: s.me, note })
                : action === "note"
                  ? yield* s.taskUpdate(id, { note: note ?? "" })
                  : action === "approve" || action === "reject"
                    ? yield* s.taskUpdate(id, { state: states[action], note: verdictNote, verdict: action === "approve" ? "approved" : "rejected", ...(round !== undefined ? { round } : {}), ...(at?.trim() ? { at: at.trim() } : {}) }, review_text)
                    : yield* s.taskUpdate(id, { state: states[action], note, ...(action === "review" && at?.trim() ? { at: at.trim() } : {}) });
        const t = state.tasks.get(id)!;
        return `${taskId(id)} ${taskStateWord(t)}${t.owner ? ` @${t.owner}` : ""}: ${inlineText(t.title, 200)}`;
      }),
    ),
  );

  server.registerTool(
    "facts",
    { description: "Shared key/value facts: read all, or set/unset one. Anyone may set or unset a key. ttl (like 7d) makes a fact expire on its own. Example: facts {\"set\":\"build.cmd\",\"value\":\"bun test\"}.", inputSchema: { set: z.string().optional(), value: z.string().optional(), unset: z.string().optional(), ttl: z.string().optional() } },
    tool(({ set, value, unset, ttl }) =>
      Effect.gen(function* () {
        if (set) yield* s.setFact(set, value ?? "", ttl ? parseDuration(ttl) : undefined);
        if (unset) yield* s.delFact(unset);
        const { facts } = (yield* s.state()).state;
        return [...facts.values()].map((f) => formatFact(f)).join("\n") || "no facts";
      }),
    ),
  );

  yield* Effect.promise(() => server.connect(new StdioServerTransport()));
  // Say what this agent runs on, so people can see it. In the background: the harness is waiting on the handshake.
  yield* Effect.forkDetach(Effect.ignoreCause(s.refreshCard(detectCard())));
  yield* Effect.forkDetach(Effect.ignoreCause(Effect.promise(() => import("./hooks.ts").then(({ holdSession }) => holdSession(s.alias, s.me)))));
  // An MCP server lives exactly as long as its client: exit when stdin closes,
  // so a crashed or killed agent never leaves an orphaned listener behind.
  const bye = () => process.exit(0);
  process.stdin.on("end", bye);
  process.stdin.on("close", bye);
  server.server.onclose = bye;

  if (!opts.push) return yield* Effect.never;
  const push = (content: string, meta: Record<string, string>) => Effect.promise(() => server.server.notification({ method: "notifications/claude/channel", params: { content, meta } }));
  yield* s.listen(
    (m, state) => {
      const line = formatMessage(m, state.trust.get(m.seq), state, s.me);
      return Effect.andThen(push(line, { seq: String(m.seq), from: m.from, kind: m.kind }), arrive({ seq: m.seq, line }));
    },
    { onNotice: (text) => Effect.andThen(push(`* ${text}`, { kind: "notice" }), arrive({ seq: null, line: text })) },
  );
});
