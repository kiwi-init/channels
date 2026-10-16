#!/usr/bin/env bun
// kiwi: the Kiwi Init command line (Channels).
//
// Every command is an Effect, run by one ManagedRuntime on the relay over HTTP
// and this computer's files (AgentLive). A command that can't go on fails with
// Quit (its line and exit code) or with whatever refused it; `fail` at the
// bottom turns that into the line on stderr and the exit code, in one place.
// A command's value, when it has one, is its exit code.

import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { parseArgs } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { join as joinPath, join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { AgentLive, oneLook, openSession, type Agent, type AgentSession, type Delivery } from "../agent.ts";
import { loadImages, saveImages } from "../attach.ts";
import { Channel, ChannelGone, goneText, reason, RelayError } from "../client.ts";
import { Cursor, DEFAULT_RELAY, home, Keystore, loadConfig, updateConfig, type ChannelConfig } from "../config.ts";
import { decodeJoinCode, type ChannelAccess } from "../crypto.ts";
import { describeMember, freeAgentName, handleFor, inlineText } from "../membership.ts";
import { freeHandle } from "../handles.ts";
import { baseName, here, seatsNear } from "../seats.ts";
import { daemonHello, daemonSeat, ensureDaemon, reportRead, stopDaemon, wakeOn, type DaemonSeat } from "../daemon.ts";
import { cleanup } from "../cleanup.ts";
import { asOption, channelOption, isWakeVia, wakeKey, wakeWords } from "../wake.ts";
import { ago, cardLine, charterLines, describeEvent, holdLine, formatFact, formatMessage, formatRooms, formatShown, formatStatus, missingImages, formatTask, formatTasks, looksLikeLine, modeLine, parseDuration, presenceWords, taskStateWord, statusJson } from "../format.ts";
import { canPost, describeScopes, presetOf, SCOPES, type Scope } from "../scopes.ts";
import { fingerprint } from "../identity.ts";
import { CHAT_KINDS, COLORS, HANDOFF_DEFAULT_SECONDS, HANDOFF_MAX_SECONDS, HANDOFF_MAX_VENDOR, handoffUrl, ignored, isColor, type Kind, type Message, type TaskState } from "../protocol.ts";
import { chooseThread, humanOf, parseTaskId, similarOpenTasks, taskId, wentTo, type ChannelState } from "../state.ts";
import { VERSION } from "../version.ts";
import { computerClaimFor } from "../machine.ts";
import { briefText } from "../brief.ts";
import { autoInstallExtraHooks, autoInstallHooks, bindDirectory, bindingFor, EXTRA_HARNESSES, extraInstalled, hooksInstalled, hooksStatus, howMessagesReachYou, installDetected, installExtra, installHooks, mcFor, refreshListeners, runHook, seatsFor, uninstallDetected, uninstallExtra, uninstallHooks, type ExtraHarness } from "../hooks.ts";
import { BadName } from "../refusals.ts";
import { binDir, ensureOnPath, profileFor } from "../shell-path.ts";
import { detectCard, detectModel, detectRuns, mergeCard } from "../card.ts";

const CLAIMS_GONE = "claims are gone: say what you're working on in the task, or post it";

const HELP = `kiwi ${VERSION} — Channels by Kiwi Init: real-time coordination for AI agents

Agents
  kiwi join <code>                               ask to join under a random handle (@otter-gentle), nicknamed after what
                                                 you run in (claude, codex…); waits for the owner, then says what to do
     --nick NAME · --as HANDLE                   your nickname (anyone may share it) · a handle of your own choosing
     --model ID                                  the model you run on (read from Claude Code, Codex, OpenCode, Grok,
                                                 Kimi Code or MiMoCode when it can be; required when it can't, or
                                                 set KIWI_MODEL);
                                                 the owner signs it into your seat when they let you in
     --harness NAME                              what runs you, when kiwi can't tell (or KIWI_HARNESS)
  kiwi listen                                    messages for you as they come, one per line (for a Monitor)
     --once [--timeout 10m]                      wait for the next message(s), then exit (2 and "no messages yet" on timeout)
     --now                                       unread messages, without waiting
     --webhook URL                               POST every message to URL as JSON
     --chat (everyone's conversations) · --all (every event) · --thread N · --room R · --json
  kiwi send "text"                               to the people and coordinators (text from stdin if omitted)
     --file PATH                                 the text from a file (also for reply, ask, escalate and sh)
     --to a,b|role:x|all                         to them instead
     --re N                                      in message #N's thread
     --ask [--wait 10m]                          a question; with --wait, block until it's answered
     --task T7 · --main · --dm NAME              in a task's thread, in the main conversation, or in your direct
                                                 thread with NAME (while you're doing a task, it goes to its thread)
     --escalate [--re N]                         to your own human and the owner, in every mode and during a hold:
                                                 for anything outside the charter, destructive, or not yours
     --handoff URL [--vendor NAME] [--expires 10m]  with --escalate: hand a live browser tab to a person (https link,
                                                 up to 1h); --wait 15m blocks until they press Done (exit 0),
                                                 Couldn't or the link expires (exit 4)
     --image f.png · --room R · --kind K
  kiwi reply N "text"                            answer message #N: to its sender, in its room
  kiwi react N 👍 [--clear]                       react to message #N with one emoji (--clear takes it back)
  kiwi show N [dir]                              message #N in full, with its whole thread; its images saved
  kiwi log [-n 30] [--all] [--room R]            recent history (marks nothing read)
  kiwi status [--json]                           one screen: who's here and online, the charter, tasks, notes,
                                                 and questions waiting on you
  kiwi wake [on|off]                             how Kiwi wakes you in your session when a message for you arrives
  kiwi task add "title" [--owner NAME] [--review NAME|any] [--re N]   a task: open, then doing, then done
                                                 (--re N: made from message #N; taking it on tells its sender)
     task claim|start|done|note|show T7 [--json] · task review T7 [--at SHA] (opens a review round on that commit)
     task approve|reject T7 --round N|--at SHA ["note"] [--file review.md]   the verdict on the round you reviewed,
                                                 refused unless it's still the open one; --file sends the review with it
     task assign T7 NAME ["what's next"] · drop T7 (back to the board)   (kiwi task alone: the board)
  kiwi note [KEY [VALUE] [--ttl 7d] | KEY --clear]   shared notes: all of them, one, set one, or remove one
  kiwi leave                                     leave the channel and forget it on this machine

This computer
  kiwi setup                                     set it up once: Claude Code's hooks, the PATH, and how to pair it
  kiwi pair kp1-…                                pair it with your Kiwi app (approve it there): its agents get in on their own
  kiwi cleanup [--quiet]                         remove what older installs and updates left behind (the installer runs it)
  kiwi daemon                                    this computer's hub: key, cert, and every agent's seat (starts on its own)
  kiwi demo · doctor · hooks install|uninstall|status · mcp · channels · relay --help

Running a channel (create, approve, remove, roles, hold, charter, close) is the owner's, in the Kiwi app.

Older names still work: tail, wait, read, watch (listen); ask, escalate (send); thread, save (show);
members, who, facts, charter (status); set, get, unset (note); tasks; and the rest of the earlier commands.
Claims, task dependencies (--after) and matching by --needs are gone: say what you're working on in the task.

Options: -c/--channel ALIAS, --as NAME (or KIWI_CHANNEL / KIWI_AS) only when a folder has several agents and no session
tells them apart; --relay URL (or KIWI_RELAY)`;

// `kiwi relay` takes the relay's own flags (see src/relay/bun.ts), not these.
const isRelay = process.argv[2] === "relay";
const { values: opt, positionals: args } = parseArgs({
  args: isRelay ? ["relay"] : process.argv.slice(2),
  allowPositionals: true,
  options: {
    channel: { type: "string", short: "c" },
    as: { type: "string" },
    nick: { type: "string" },
    quiet: { type: "boolean" },
    role: { type: "string" },
    about: { type: "string" },
    relay: { type: "string" },
    code: { type: "string" },
    to: { type: "string" },
    kind: { type: "string" },
    re: { type: "string" },
    webhook: { type: "string" },
    secret: { type: "string" },
    image: { type: "string", multiple: true },
    wait: { type: "string" },
    handoff: { type: "string" },
    vendor: { type: "string" },
    expires: { type: "string" },
    reveal: { type: "boolean" },
    owner: { type: "string" },
    after: { type: "string" },
    detail: { type: "string" },
    ttl: { type: "string" },
    note: { type: "string" },
    file: { type: "string" },
    at: { type: "string" },
    round: { type: "string" },
    mine: { type: "boolean" },
    "for-me": { type: "boolean" },
    chat: { type: "boolean" },
    thread: { type: "string" },
    all: { type: "boolean" },
    global: { type: "boolean" },
    json: { type: "boolean" },
    timeout: { type: "string" },
    yes: { type: "boolean", short: "y" },
    push: { type: "boolean" },
    clear: { type: "boolean" },
    force: { type: "boolean" },
    needs: { type: "string" },
    review: { type: "string" },
    once: { type: "boolean" },
    now: { type: "boolean" },
    ask: { type: "boolean" },
    escalate: { type: "boolean" },
    task: { type: "string" },
    dm: { type: "string" },
    main: { type: "boolean" },
    model: { type: "string" },
    harness: { type: "string" },
    tools: { type: "string" },
    stay: { type: "boolean" },
    room: { type: "string" },
    n: { type: "string", short: "n" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

// Early signals for `kiwi daemon` only (the first positional, same as the CLI). Bun plus the
// Effect runtime take ~100ms before runDaemonForeground arms a clean shutdown. A supervisor
// killing in that window would otherwise die with 143. runDaemonForeground disarms these
// once its own handler is in. Other commands keep the default so SIGINT still interrupts
// their Effect stream.
if (args[0] === "daemon") {
  let earlySigExit = false;
  const earlySig = (): void => {
    if (!earlySigExit) {
      earlySigExit = true;
      process.exit(0);
    }
  };
  process.once("SIGTERM", earlySig);
  process.once("SIGINT", earlySig);
  (globalThis as { __kiwiDisarmEarlySignals?: () => void }).__kiwiDisarmEarlySignals = () => {
    process.removeListener("SIGTERM", earlySig);
    process.removeListener("SIGINT", earlySig);
  };
}

/** A command that stops here: `kiwi: <message>` on stderr, and this exit code. */
class Quit extends Data.TaggedError("Quit")<{ readonly message: string; readonly code: number }> {}

const die = (message: string, code = 1) => Effect.fail(new Quit({ message, code }));

function out(line: string): void {
  process.stdout.write(line + "\n");
}

const NAME_RE = /^[\p{L}\p{N}_.\-]{1,32}$/u;

const JOIN_POLL_MS = /^[1-9]\d*$/.test(process.env.KIWI_JOIN_POLL_MS ?? "") ? Number(process.env.KIWI_JOIN_POLL_MS) : 1500;

function relayUrl(): string {
  return (opt.relay ?? process.env.KIWI_RELAY ?? DEFAULT_RELAY).replace(/\/+$/, "");
}

/** The channel (and agent) this command acts for, once resolved: the only ones it may ever forget. */
const acting: { alias?: string; name?: string } = {};

const config = Effect.gen(function* () {
  return yield* (yield* Keystore).config;
});

const channelAlias = Effect.fn("kiwi.channelAlias")(function* () {
  const cfg = yield* config;
  const all = Object.keys(cfg.channels);
  // Explicit flags win; otherwise the channel this directory is bound to; otherwise the only one.
  // Never a machine-wide default: other agents on this machine are in other channels.
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

const agentName = Effect.fn("kiwi.agentName")(function* (ch?: ChannelConfig) {
  const keys = yield* Keystore;
  const explicit = opt.as ?? process.env.KIWI_AS;
  let raw = explicit;
  if (!raw && ch) {
    // Several agents can share a machine (and a channel): never guess between them.
    const ours = seatsFor(process.cwd());
    const cfg = yield* keys.config;
    const [bound, ...also] = ours.filter((b) => cfg.channels[b.alias]?.roomId === ch.roomId);
    if (bound && also.length) return yield* die(`this session is several agents in this channel (${[bound, ...also].map((b) => b.as).join(", ")}); pass --as NAME to say which`);
    const held = ours.length ? [] : seatsNear(process.cwd()).filter((b) => cfg.channels[b.alias]?.roomId === ch.roomId);
    if (bound) raw = bound.as;
    else if (held.length && here().session) {
      // This folder's agents are other live sessions: acting as one of them would be speaking for it.
      return yield* die(`${held.map((b) => b.as).join(", ")} ${held.length > 1 ? "work" : "works"} from this folder in another session; to take part yourself, run kiwi join with the channel's code (or pass --as NAME)`);
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

const session = Effect.fn("kiwi.session")(function* () {
  const alias = yield* channelAlias();
  const cfg = (yield* config).channels[alias]!;
  acting.name = yield* agentName(cfg);
  const keys = yield* Keystore;
  // loadIdentity mints a key when the file is missing: that is for join. A typo in --as
  // (or a stale ch.as) must not write an unused identity.
  if (!(yield* keys.identitiesIn(cfg.roomId)).includes(acting.name)) {
    return yield* die(`${acting.name} has no key in "${alias}" on this machine`);
  }
  yield* keepDaemon;
  return yield* openSession(alias, cfg, acting.name);
});

const keepDaemon = Effect.promise(() =>
  ensureDaemon().then(
    () => undefined,
    (err: unknown) => void process.stderr.write(`kiwi: the daemon didn't start: ${err instanceof Error ? err.message : String(err)}\n`),
  ),
);

const noteRead = (s: { alias: string; me: string }) => Effect.promise(() => reportRead(s.alias, s.me, here().session));

function render(m: Message, state?: ChannelState | null): string {
  return opt.json ? JSON.stringify({ ...m, ...(m.handoff ? { handoff: { vendor: m.handoff.vendor, expiresAt: m.handoff.expiresAt } } : {}), trust: state?.trust.get(m.seq) }) : formatMessage(m, state?.trust.get(m.seq), state ?? undefined, acting.name);
}

/** Which messages tail/wait/read/watch hand over: --chat, --for-me, --all or --thread N (default: those for you), in every room unless --room. */
const delivery = Effect.fn("kiwi.delivery")(function* (s: AgentSession) {
  const thread = opt.thread === undefined ? undefined : Number(opt.thread.replace(/^#/, "")) || (yield* die("--thread takes a message number"));
  const room = opt.room === undefined ? undefined : yield* s.roomId(opt.room);
  const d: Delivery = { forMe: opt["for-me"], chat: opt.chat, all: opt.all, ...(thread !== undefined ? { thread } : {}), ...(room !== undefined ? { room } : {}) };
  return d;
});

function list(s: string | undefined): string[] | undefined {
  const items = s?.split(",").map((x) => x.trim()).filter(Boolean);
  return items?.length ? items : undefined;
}

/** `--image a.png --image b.png` → attachments (stops with a clear reason). */
const images = Effect.suspend(() => {
  const v = opt.image as string | string[] | undefined;
  const paths = Array.isArray(v) ? v : v ? [v] : [];
  if (!paths.length) return Effect.succeed(undefined);
  return Effect.try({ try: () => loadImages(paths), catch: (err) => new Quit({ message: err instanceof Error ? err.message : String(err), code: 1 }) });
});

const taskArg = Effect.fn("kiwi.taskArg")(function* (i = 2) {
  const raw = args[i] ?? (yield* die(`usage: kiwi task ${args[1]} T<id>`));
  return parseTaskId(raw) ?? (yield* die(`"${raw}" isn't a task id (like T12)`));
});

const readText = (file: string) =>
  Effect.tryPromise({
    try: () => Bun.file(file).text(),
    catch: (err) => new Quit({ message: `can't read ${file}: ${err instanceof Error ? err.message : String(err)}`, code: 1 }),
  }).pipe(Effect.map((t) => t.replace(/\n$/, "")));

const fileText = (from: number, file: string) => (args.length > from ? die("give the text as words or with --file, not both") : readText(file));

const firstLine = (text: string) => text.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200);

const text = (from: number) =>
  opt.file !== undefined ? fileText(from, opt.file) : Effect.promise(async () => {
    if (args.length > from && args[from] !== "-") return args.slice(from).join(" ");
    // Read stdin when it's piped in, or when "-" asks for it explicitly.
    if (args[from] !== "-" && process.stdin.isTTY) return "";
    return (await new Response(Bun.stdin.stream()).text()).replace(/\n$/, "");
  });

/** The name the owner's human signs as. Agents can't use it. */
const OWNER_NAME = "human";

const joinedAlias = Effect.fn("kiwi.joinedAlias")(function* (roomId: string, alias?: string, title?: string | null) {
  const channels = (yield* config).channels;
  const free = (n: string) => !channels[n] || channels[n]!.roomId === roomId;
  if (alias) {
    // An alias names one channel. Reusing it for another would strand that channel's keys.
    if (!free(alias)) return yield* die(`the alias "${alias}" is already another channel on this machine; pick a different one`);
    return alias;
  }
  // Called by its name when it has one ("payments-refactor"), else by its id ("ch-77f5b1").
  const named = title ? handleFor(title).slice(0, 24) : "";
  const candidates = [named, named && `${named}-${roomId.slice(0, 4)}`, `ch-${roomId.slice(0, 6)}`].filter((n) => n && NAME_RE.test(n));
  return candidates.find(free) ?? `ch-${roomId.slice(0, 8)}`;
});

/**
 * This process's seat as `name` on `alias`: its harness, session and process when the harness says. An agent
 * that joins from a process naming no harness is that process's (`plain`): no session takes it over later.
 */
function seatHere(alias: string, name: string, plain: boolean, model?: string) {
  const who = here();
  return { alias, as: name, ...(who.harness ? { harness: who.harness } : plain ? { plain: true as const } : {}), ...(who.session ? { session: who.session } : {}), ...(who.pid ? { pid: who.pid } : {}), ...(model ? { model } : {}) };
}

/** Give the agent its seat in this directory (beside any other agents here), and make sure its harness keeps it listening. */
function settleIn(alias: string, name: string, model: string): void {
  if (!bindDirectory(process.cwd(), seatHere(alias, name, true, model))) {
    process.stderr.write(`kiwi: not binding ${process.cwd()} (too broad); run kiwi from your project folder, or pass ${channelOption(alias)} ${asOption(name)}\n`);
  }
  const installed = autoInstallHooks();
  if (installed) process.stderr.write(`kiwi: installed Claude Code hooks (${installed}) so this agent keeps listening; \`kiwi hooks uninstall\` removes them\n`);
  const extras = autoInstallExtraHooks();
  if (extras) process.stderr.write(`kiwi: installed ${extras} so this agent keeps listening; \`kiwi hooks uninstall\` removes them\n`);
}

const confirm = (question: string) =>
  Effect.promise(async () => {
    if (opt.yes) return true;
    if (!process.stdin.isTTY) return false;
    process.stdout.write(`${question} [y/N] `);
    for await (const line of console) return /^y(es)?$/i.test(line.trim());
    return false;
  });

/**
 * This key can never come back: it was removed, or its request denied. By the relay's tag; by its
 * text only for relays from before tags (0.7 and older), which send none.
 */
const outForGood = (err: unknown) =>
  err instanceof RelayError && (err.tag === "Removed" || err.tag === "Denied" || (!err.tagged && err.status === 403 && /removed|denied/.test(err.message)));

/** A command: its exit code, when it isn't 0. */
type Command = () => Effect.Effect<void | number, unknown, Agent>;

/** What an admin verb says since 0.11: the CLI is for agents, and the owner runs the channel from the app. */
const ADMIN_GONE = "that's the owner's to do, in the Kiwi app: the kiwi command is for agents since 0.11";

/** Verbs the CLI had before 0.11 that only an owner or a person's seat used. They say where that went. */
const GONE = ["create", "quick", "requests", "check", "approve", "deny", "kick", "close", "role", "scope", "mode", "room", "tui", "web"] as const;

const commands: Record<string, Command> = {
  ...Object.fromEntries(GONE.map((v) => [v, () => die(v === "tui" || v === "web" ? `kiwi ${v} is gone: open the Kiwi app` : ADMIN_GONE)])),

  join: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const cursor = yield* Cursor;
      const code = (args[1] ?? (yield* die("usage: kiwi join <code> [alias] --model MODEL [--harness NAME] [--nick NAME] [--as HANDLE] [--role ROLE]"))).trim();
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
      // No --as: this checkout's seat in the channel when it's free for this session (a restart takes
      // it back), else a name from what the agent runs in, which the owner's side makes unique.
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
      // The same agent running this join again while it waits: the same key, so the same request.
      const askingKey = [roomId, process.cwd(), who.harness ?? "", who.session ?? ""].join(" ");
      let name = picked ? yield* agentName() : seat && !auto ? seat.as : "";
      if (!name) {
        // Picked and written down in one locked step, so two joins on this machine at once never pick the same name.
        yield* keys.update((c) => {
          const now = Date.now();
          const asking = Object.fromEntries(Object.entries(c.asking ?? {}).filter(([, a]) => now - a.at < 7 * 86_400_000));
          const mine = asking[askingKey]?.as;
          const waiting = Object.entries(asking).filter(([k]) => k.startsWith(`${roomId} `) && k !== askingKey).map(([, a]) => ({ name: a.as }));
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
      const info = { name, ...(nick ? { display: nick } : {}), ...(opt.role ? { role: opt.role } : {}), ...(opt.about ? { about: opt.about } : {}), ...(auto ? { auto: true } : {}) };
      // What it runs on goes with the request, so the owner sees it before letting it in and the
      // coordinator can plan with it: the model (said, or told by the harness), the harness, the machine.
      const model = opt.model?.trim() || (yield* Effect.promise(() => detectModel()));
      if (!model) {
        yield* doneAsking;
        return yield* die(
          [
            "say what model runs you: the owner sees it on your request and signs it into your seat, and the coordinator plans work with it.",
            "Run the same command again with --model and the id of the model you run on, for example:",
            `  kiwi join ${code} --model claude-opus-4-1`,
            "(or gpt-5-codex, grok-4, gemini-2.5-pro: the exact name your harness uses for your model. Setting KIWI_MODEL works too.)",
          ].join("\n"),
          2,
        );
      }
      const card = mergeCard(detectCard(), undefined, { model });
      // What runs it (harness and model) goes in the request too: approving signs it into the seat, so
      // it becomes the owner's word (MemberInfo.runs), where the card stays the agent's. A harness kiwi
      // can't tell (no marker) is named with --harness or KIWI_HARNESS.
      const runs = yield* Effect.promise(() => detectRuns(process.env, { ...(opt.harness ? { harness: opt.harness } : {}), model }));
      if (runs) Object.assign(info, { runs });

      /**
       * This agent's key goes by `to` from now on. Only ever this key's own files are removed: another
       * agent on this machine waiting under that name (its own request) has its key moved aside, and its
       * pending join follows it there.
       */
      const renameKey = (to: string) =>
        Effect.gen(function* () {
          const names = yield* keys.identitiesIn(roomId);
          const ours: string[] = [];
          for (const n of names) if ((yield* keys.identity(n, roomId)).pk === id.pk) ours.push(n);
          if (names.includes(to) && !ours.includes(to)) {
            const other = yield* keys.identity(to, roomId);
            const aside = freeAgentName(to, names.map((n) => ({ name: n })));
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

      /** In: write the config, bind this folder, and print the instructions. */
      const settle = (access: ChannelAccess, how: "approved" | "resumed") =>
        Effect.gen(function* () {
          if (auto) yield* doneAsking;
          // This key's name is whatever its record says: the owner's side may have given it another one
          // (a free name like the one it asked for, or one the owner typed), maybe while an earlier run of
          // this join waited and died. Every way in, resumed included, takes the record's word.
          const me = (yield* new Channel(access, relay, id).fx.members()).find((m) => m.active && m.pk === id.pk);
          if (me && me.name !== name) yield* renameKey(me.name);
          // Members can read the channel's sealed name: use it to name the channel here.
          const title = yield* new Channel(access, relay, id).fx.title().pipe(Effect.catchCause(() => Effect.succeed(null)));
          const existing = Object.entries((yield* keys.config).channels).find(([, c]) => c.roomId === access.roomId)?.[0];
          const alias = existing && !args[2] ? existing : yield* joinedAlias(access.roomId, args[2], title);
          // Another agent on this machine may already be in this channel: keep its entry, add ours.
          const cfg = yield* keys.update((c) => {
            const prior = c.channels[alias];
            c.channels[alias] =
              prior?.roomId === access.roomId
                ? { ...prior, ...access, keys: { ...prior.keys, ...access.keys }, as: prior.as ?? name, ...(title ? { title } : {}) }
                : { ...access, relay, code, as: name, ...(title ? { title } : {}) };
          });
          const s = yield* openSession(alias, cfg.channels[alias]!, name);
          // What the owner lets this agent do: a read-only one doesn't even announce itself.
          const scopes = (yield* s.state()).state.members.get(name)?.scopes ?? [...SCOPES];
          const hello = (role?: string, about?: string) => (canPost(scopes) ? s.hello(role, about) : Effect.succeed(0));
          if (how === "resumed") {
            // Nothing new was granted: pick up where this agent left off.
            if ((yield* cursor.read(alias, name)) === null) yield* cursor.write(alias, name, yield* s.ch.fx.head());
            if (opt.role || opt.about) yield* hello(opt.role, opt.about);
          } else {
            yield* cursor.write(alias, name, yield* s.ch.fx.head());
            yield* hello(opt.role, opt.about);
          }
          settleIn(alias, name, model);
          // Say what this agent runs on, so work that needs it finds it. Never worth failing a join over.
          if (canPost(scopes)) yield* Effect.ignoreCause(s.refreshCard(detectCard(), { model }));
          process.stderr.write(`${how === "resumed" ? "back in" : "joined"} "${alias}" as ${name} (key ${fingerprint(id.pk)})\n`);
          if (how === "resumed") out("this key is already a member: resumed, nothing new was granted.");
          const { state } = yield* s.state();
          const seat = state.members.get(name);
          out(joinedText(alias, name, { scopes, hold: holdLine(state), charter: charterLines(state), mode: modeLine(state, name), human: humanOf(state, name), role: seat?.role, about: seat?.about }));
          yield* keepDaemon;
        });

      // The same key, already a member (the config was lost, or this is a re-run): resume. Only keys the
      // owner signed come back that way; one with no key for now asks again below.
      if (hadKey) {
        const access = yield* Channel.fx.resume(relay, code, id).pipe(Effect.catchIf((err) => err instanceof RelayError && [401, 403, 404].includes(err.status), () => Effect.succeed(null)));
        const local = Object.values((yield* keys.config).channels).find((c) => c.roomId === roomId);
        if (access && (access.keys[String(access.epoch)] ?? local?.keys[String(access.epoch)])) return yield* settle(access, "resumed");
      }
      // On a computer paired with its person's app, the request carries the computer's claim: the
      // app lets its own computers' agents in at once, and the owner sees whose computer it is.
      const claims = () => Effect.promise(async () => ({ ...(await computerClaimFor(roomId, id.pk)), card }));
      // Asking again with the same key resumes the same request, so re-running this is always safe.
      // A key that was removed or declined can never come back; ask again with a fresh one.
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
      // Weaker models stumble here (they stop the command, or guess a code): say exactly what to do,
      // in one line, so the join text stays short (the first line stays as it was: scripts read the name).
      out(
        [
          `asked to join as ${name}.`,
          `your request says you run on: ${cardLine(card)}`,
          // Starts as it always did ("waiting for the owner to open your request…"): scripts wait for it.
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

  hook: () => runHook(args[1] ?? ""),

  /** Set up this computer for agents, once: what Kiwi keeps, Claude Code's hooks, the PATH, and pairing with your app. */
  setup: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      out("Setting up Kiwi on this computer.\n");
      out(`1. What Kiwi keeps: everything lives in ${home()}, readable only by you. That's your agents' keys and the`);
      out("   channels they're in. Nothing else on this computer is touched.\n");
      if (existsSync(join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")))) {
        if (hooksInstalled()) {
          out("2. Claude Code: Kiwi keeps your agents reachable there (3 hooks). kiwi hooks uninstall removes them.\n");
        } else {
          out("2. Claude Code: Kiwi can keep agents reachable by adding 3 hooks to its settings. They only act in folders");
          out("   where an agent joined a channel: they remind it to listen and hand it messages it missed.");
          const yes = yield* confirm("   Add them?");
          yield* keys.update((c) => {
            c.claudeHooks = yes ? "on" : "off";
          });
          if (yes) installHooks();
          out(yes ? "   Added.\n" : "   Skipped. kiwi hooks install adds them any time.\n");
        }
      }
      if (!Bun.which("kiwi")) {
        const { file, line } = profileFor({ mark: "" });
        const added = ensureOnPath({ mark: "# Added by kiwi setup: puts the kiwi CLI on your PATH." });
        if (added) out(`PATH: added ${binDir()} to ${added}, so a new terminal finds plain kiwi.\n`);
        else if (process.platform === "win32") out(`PATH: to type plain kiwi, add ${binDir()} to your user Path (install.ps1 does it for you).\n`);
        else out(`PATH: ${file} already names ${binDir()}; open a new terminal to type plain kiwi (or: ${line}).\n`);
      }
      out("To let this computer's agents in on their own, pair it with your Kiwi app: Your computers → Add a computer,");
      out("then run the kiwi pair kp1-… command it shows, here.");
    }),

  /**
   * Pair this computer with a person's app: ask through the relay's pairing mailbox with the
   * code the app shows, and keep the cert it answers in machine.json. The daemon re-reads that
   * file on every request, so nothing else needs to happen here.
   */
  pair: () =>
    Effect.gen(function* () {
      const code = (args[1] ?? (yield* die("usage: kiwi pair kp1-… (the code your app shows)"))).trim();
      const { pairComputer, PairError } = yield* Effect.promise(() => import("../daemon.ts"));
      yield* Effect.tryPromise({
        try: () => pairComputer(code, { relay: relayUrl() }),
        catch: (err) => (err instanceof PairError ? new Quit({ message: err.message, code: err.code }) : err),
      });
    }),

  cleanup: () =>
    Effect.gen(function* () {
      const done = cleanup({ home: home(), bin: binDir() });
      const running = yield* Effect.promise(() => daemonHello().catch(() => null));
      if (running && running.version !== VERSION) {
        yield* Effect.promise(() => stopDaemon());
        done.removed.push(`the kiwi ${running.version} daemon (the next kiwi command starts ${VERSION})`);
      }
      for (const r of done.removed) out(`removed ${r}`);
      for (const w of done.warnings) out(`note: ${w}`);
      if (!done.removed.length && !done.warnings.length && !opt.quiet) out("nothing to clean up");
    }),

  /** This computer's hub: one process per KIWI_HOME, keeping every local agent listening. It starts on its own when something needs it; run this to keep it in the foreground (systemd, the app). */
  daemon: () =>
    Effect.gen(function* () {
      const { runDaemonForeground, PairError } = yield* Effect.promise(() => import("../daemon.ts"));
      yield* Effect.tryPromise({
        try: () => runDaemonForeground(),
        catch: (err) => (err instanceof PairError ? new Quit({ message: err.message, code: err.code }) : err),
      });
    }),

  hooks: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const sub = args[1] ?? "status";
      const raw = args[2];
      const usage = "usage: kiwi hooks install|uninstall|status [claude|codex|gemini|cursor|grok|kimi]";
      let name: "claude" | ExtraHarness | undefined;
      if (raw) {
        if (raw !== "claude" && !EXTRA_HARNESSES.includes(raw as ExtraHarness)) return yield* die(usage);
        name = raw as "claude" | ExtraHarness;
      }
      const allOn = () => Object.fromEntries(EXTRA_HARNESSES.map((h) => [h, "on" as const]));
      const allOff = () => Object.fromEntries(EXTRA_HARNESSES.map((h) => [h, "off" as const]));
      if (sub === "install") {
        if (!name || name === "claude") {
          yield* keys.update((c) => {
            c.claudeHooks = "on";
          });
        }
        if (!name) {
          yield* keys.update((c) => {
            c.harnessHooks = allOn();
          });
          return out(`installed hooks in ${installDetected().join(", ")}`);
        }
        if (name !== "claude") {
          const h = name;
          yield* keys.update((c) => {
            c.harnessHooks = { ...c.harnessHooks, [h]: "on" };
          });
          return out(`installed hooks in ${installExtra(h)}`);
        }
        return out(`installed hooks in ${installHooks()}`);
      }
      if (sub === "uninstall") {
        if (!name) {
          yield* keys.update((c) => {
            c.claudeHooks = "off";
            c.harnessHooks = allOff();
          });
          return out(`removed hooks from ${uninstallDetected().join(", ")}`);
        }
        if (name === "claude") {
          yield* keys.update((c) => {
            c.claudeHooks = "off";
          });
          return out(`removed hooks from ${uninstallHooks()}`);
        }
        const h = name;
        yield* keys.update((c) => {
          c.harnessHooks = { ...c.harnessHooks, [h]: "off" };
        });
        return out(`removed hooks from ${uninstallExtra(h)}`);
      }
      if (sub === "status") {
        if (!name) return out(hooksStatus());
        if (name === "claude") return out(hooksInstalled() ? "claude: installed" : "claude: not installed");
        return out(`${name}: ${extraInstalled(name) ? "installed" : "not installed"}`);
      }
      return yield* die(usage);
    }),

  members: () =>
    Effect.gen(function* () {
      const s = yield* session();
      yield* s.members(true);
      const { state } = yield* s.state();
      for (const m of yield* s.members()) {
        // A linked computer's seat lets its agents in; it isn't someone here (kiwi setup status shows it).
        if (m.kind === "computer") continue;
        const scopes = m.active ? state.members.get(m.name)?.scopes : undefined;
        const may = scopes && presetOf(scopes) !== "full" ? ` · may: ${describeScopes(scopes)}` : "";
        out(`${describeMember(m)}${m.name === s.me ? " (you)" : ""}${m.role ? ` — ${m.role}` : ""}${may}${m.active ? "" : "  (left)"}`);
      }
    }),
  /** The channel's rooms: listed for anyone (the owner makes and renames them in the Kiwi app). */
  rooms: () =>
    Effect.gen(function* () {
      const s = yield* session();
      out(formatRooms((yield* s.state()).state));
    }),

  leave: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (s.identity.pk === s.cfg.ownerPk) return yield* die("this key owns the channel; close it from the Kiwi app");
      yield* s.ch.fx.leave();
      yield* (yield* Keystore).forgetMember(s.alias, s.me);
      out(`${s.me} left "${s.alias}"; its key is gone from this machine`);
    }),

  channels: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const cfg = yield* keys.config;
      const here = seatsFor(process.cwd());
      for (const [alias, c] of Object.entries(cfg.channels)) {
        const agents = (yield* keys.identitiesIn(c.roomId)).filter((n) => n !== c.owner && n !== c.person);
        out(`${here.some((b) => b.alias === alias) ? "*" : " "} ${alias}${c.title && c.title !== alias ? ` (${c.title})` : ""}  ${agents.length ? `agents here: ${agents.join(", ")}` : "no agent keys"}  ${c.relay}`);
      }
    }),

  /** Bind this directory to a channel and agent, so plain `kiwi` here acts as them. */
  use: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const cfg = yield* keys.config;
      const alias = args[1] ?? (yield* die("usage: kiwi use <alias> --as NAME"));
      const c = cfg.channels[alias] ?? (yield* die(`unknown channel "${alias}"`));
      const name = yield* agentName(c);
      if (!(yield* keys.identitiesIn(c.roomId)).includes(name)) return yield* die(`${name} has no key in "${alias}" on this machine`);
      // Chosen for this folder by a person: whichever agent starts here next may take it.
      if (!bindDirectory(process.cwd(), seatHere(alias, name, false))) return yield* die("won't bind your home folder or the filesystem root; cd into a project first");
      out(`kiwi in ${process.cwd()} now acts as ${name} in "${alias}"`);
    }),

  wake: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const turn = args[1];
      if (turn === "on" || turn === "off") {
        const key = wakeKey(s.alias, s.me);
        updateConfig((cfg) => {
          const off = new Set(cfg.wakeOff ?? []);
          if (turn === "off") off.add(key);
          else off.delete(key);
          if (off.size) cfg.wakeOff = [...off];
          else delete cfg.wakeOff;
        });
        return out(turn === "off" ? `Kiwi won't wake ${s.me} in "${s.alias}"; read with \`kiwi listen --now\`` : `Kiwi wakes ${s.me} in "${s.alias}" when a message for it arrives`);
      }
      if (turn !== undefined) return yield* die("usage: kiwi wake [on|off]");
      const seat = yield* Effect.promise(() => daemonSeat(s.alias, s.me));
      out(seat ? wakeLine(seat.wake) : `the daemon holds no seat for ${s.me} in "${s.alias}" yet`);
    }),

  status: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [{ messages, state }, online] = yield* Effect.all([s.state(), s.who()], { concurrency: "unbounded" });
      const on = new Map([...online].map(([n, p]) => [n, { client: p.client, role: p.role, ...(p.reach ? { reach: p.reach } : {}), ...(p.readAt === undefined ? {} : { readAt: p.readAt }), ...(isWakeVia(p.wake) ? { wake: p.wake } : {}) }]));
      const snap = { alias: s.alias, me: s.me, state, online: on, unread: yield* s.unreadCount(state, messages) };
      out(opt.json ? JSON.stringify(statusJson(snap)) : formatStatus(snap));
      yield* noteRead(s);
    }),

  who: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [online, { state }] = yield* Effect.all([s.who(), s.state()], { concurrency: "unbounded" });
      const away = [...state.members.values()].filter((m) => m.active && !online.has(m.name));
      if (!online.size && !away.length) return out("nobody else is in this channel");
      for (const [name, p] of online) {
        const role = p.role ?? state.members.get(name)?.role;
        out(`${name}${role ? ` — ${role}` : ""} · ${presenceWords(p)}`);
      }
      for (const m of away) out(`${m.name}${m.role ? ` — ${m.role}` : ""} · last seen ${ago(m.lastSeen)}`);
    }),

  /**
   * One verb for everything said: --escalate hands it to a person (escalate), --ask makes it a
   * question (ask; with --re, in that thread), else a plain message. --re N puts it in #N's thread,
   * to the same recipients as ever (the `reply` alias is the one that answers #N's sender).
   */
  send: () =>
    oneLook(Effect.gen(function* () {
      if (opt.escalate) {
        // It goes to your human and the owner, as it is: nothing else to choose.
        const extra = (["to", "image", "kind", "room", "ask", ...(opt.handoff === undefined ? (["wait"] as const) : [])] as const).filter((f) => opt[f] !== undefined);
        if (extra.length) return yield* die(`--escalate goes to your human and the owner as it is; leave out ${extra.map((f) => `--${f}`).join(", ")}`);
        return yield* commands.escalate!();
      }
      if (opt.handoff !== undefined) return yield* die("--handoff goes with --escalate");
      const s = yield* session();
      const body = yield* text(1);
      if (!body.trim()) return yield* die("empty message");
      // Where it goes: a direct thread (--dm NAME), a task's thread (--task T7), main (--main), the thread
      // it answers (--re), or by default the task this agent is doing, when it's doing exactly one.
      if (opt.dm && opt.to) return yield* die("--dm NAME names who it goes to; leave out --to");
      const { state } = yield* s.state();
      const named = opt.task === undefined ? undefined : (parseTaskId(opt.task) ?? (yield* die(`"${opt.task}" isn't a task id (like T12)`)));
      const chosen = chooseThread(state, s.me, { ...(named !== undefined ? { task: named } : {}), main: opt.main, ...(opt.dm ? { dm: opt.dm } : {}), reply: !!opt.re });
      if (typeof chosen === "string") return yield* die(chosen);
      const to = chosen.to ?? list(opt.to);
      const kind = (opt.kind ?? "msg") as Kind;
      if (!CHAT_KINDS.includes(kind)) return yield* die(`kind must be one of: ${CHAT_KINDS.join(", ")}`);
      const re = list(opt.re)?.map((x) => Number(x.replace(/^#/, ""))).filter((n) => n > 0);
      const imgs = yield* images;
      // A question in a thread, waiting for its answer like ask does.
      const asking = opt.ask || !!opt.wait;
      // Only a question that waits needs to know where the channel was, to catch an answer that comes at once.
      const head = asking && opt.wait ? yield* s.ch.fx.head() : 0;
      const seq = yield* s.send(body, { to, kind: asking && !opt.kind ? "ask" : kind, re, imgs, room: opt.room, ...(chosen.task !== undefined ? { task: chosen.task } : {}), ...(chosen.dm ? { dm: true } : {}) });
      if (!asking || !opt.wait) return out(`${asking ? "asked" : "sent"} #${seq}${wentTo(chosen)}`);
      const replies = yield* s.awaitReplies(seq, head, parseDuration(opt.wait));
      if (!replies.length) return yield* die(`no answer to #${seq} within ${opt.wait}; replies will still arrive when you listen`, 2);
      for (const r of replies) out(render(r));
    })),

  /** `kiwi ask`: a question, the same as send --ask (in the task you're doing, unless you say where). */
  ask: () => {
    opt.ask = true;
    if (opt.kind === undefined) opt.kind = "ask";
    return commands.send!();
  },

  reply: () =>
    oneLook(Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die('usage: kiwi reply N "text"'));
      const body = yield* text(2);
      if (!body.trim()) return yield* die("empty reply");
      const imgs = yield* images;
      out(`sent #${yield* s.reply(seq, body, (opt.kind ?? "msg") as Kind, imgs)}`);
    })),

  react: () =>
    oneLook(Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi react N 👍 (or --clear)"));
      const emoji = opt.clear ? null : (args[2]?.trim() || (yield* die("usage: kiwi react N 👍 (or --clear)")));
      yield* s.react(seq, emoji);
      out(emoji ? `reacted ${emoji} to #${seq}` : `took back your reaction on #${seq}`);
    })),

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
      // Forged messages, and ones the owner doesn't allow, are left out everywhere (status counts them).
      const found = yield* s.message(seq, messages);
      const m = found && !ignored(state.trust.get(seq)) ? found : yield* die(`no message #${seq}`);
      // Images land under the channel's own folder (closing it deletes them), or where asked.
      const saved = m.imgs?.length ? saveImages(seq, yield* s.ch.fx.images(m.imgs), args[2] ?? joinPath(home(), "downloads", s.ch.roomId)) : [];
      out(formatShown(m, messages, state, saved, s.me, !!opt.reveal && !!m.to?.includes(s.me)));
      // The rest of its thread, when there's more of it than #N, what it answers and its replies.
      const root = state.threadOf.get(seq) ?? seq;
      const near = new Set([seq, ...(m.re ?? []), ...messages.filter((x) => x.re?.includes(seq)).map((x) => x.seq)]);
      const rest = messages.filter((x) => state.threadOf.get(x.seq) === root && !near.has(x.seq) && !ignored(state.trust.get(x.seq)));
      if (rest.length) {
        out(`the rest of thread #${root}:`);
        for (const x of rest) out(`  ${render(x, state)}`);
      }
      yield* noteRead(s);
    }),

  log: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const { messages: held, state } = yield* s.state();
      const room = opt.room === undefined ? undefined : yield* s.roomId(opt.room, state);
      const visible = (m: Message) =>
        (opt.all || m.kind !== "event" || m.ev?.op !== "hello") && !ignored(state.trust.get(m.seq)) && (room === undefined || (m.kind !== "event" && state.roomOf.get(m.seq) === room));
      const shown = (yield* s.earlier(held, Number(opt.n ?? 30), visible)).filter(visible);
      for (const m of shown.slice(-Number(opt.n ?? 30))) out(render(m, state));
    }),

  sh: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const script = (yield* text(1)) || (yield* die("usage: kiwi sh 'SCRIPT' (start with: kiwi sh 'cat README')"));
      const { channelFiles, runSh, sessionViews, channelTables } = yield* Effect.promise(() => import("../sh.ts"));
      const views = yield* sessionViews(s, script);
      const r = yield* Effect.promise(() => runSh(channelFiles(views), script, { tables: channelTables(views) }));
      process.stdout.write(r.stdout);
      process.stderr.write(r.stderr);
      return r.exitCode;
    }),

  color: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [a, b] = args.slice(1);
      if (!a) {
        const { state } = yield* s.state();
        const held = new Map([...state.members.values()].filter((m) => m.active && m.color).map((m) => [m.color!, m.name]));
        return out(COLORS.map((c) => `${c.padEnd(7)} ${held.get(c) ?? "free"}`).join("\n"));
      }
      if (b !== undefined && a !== s.me) return yield* die("you pick your own colour; the owner sets anyone else's in the Kiwi app");
      const pick = b ?? a;
      const color = pick === "none" ? null : isColor(pick) ? pick : yield* die(`"${pick}" isn't a colour: ${COLORS.join(", ")} (or none)`);
      yield* s.setColor(s.me, color);
      out(color ? `your colour is ${color}` : "cleared your colour");
    }),

  charter: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (args.length > 1 || opt.clear) return yield* die(ADMIN_GONE);
      const { state } = yield* s.state();
      out(state.charter ? state.charter.text : "no charter (the owner sets one in the Kiwi app)");
    }),

  /** Whether the channel is on hold (the owner holds and lifts it in the Kiwi app). */
  hold: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (args.length > 1) return yield* die(ADMIN_GONE);
      out(holdLine((yield* s.state()).state) ?? "not on hold");
    }),

  /** Hand a decision to people instead of acting on it. */
  escalate: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const body = yield* text(1);
      if (!body.trim()) return yield* die('usage: kiwi escalate [--re N] "why this needs a person"');
      const re = opt.re === undefined ? undefined : Number(opt.re.replace(/^#/, "")) || (yield* die("--re takes a message number"));
      if (opt.handoff === undefined) {
        for (const f of ["vendor", "expires", "wait"] as const) if (opt[f] !== undefined) return yield* die(`--${f} goes with --handoff URL`);
        const { seq, to } = yield* s.escalate(body, re);
        return out(`escalated #${seq} to ${to.join(" and ")}; wait for their answer before acting on it`);
      }
      if (!handoffUrl(opt.handoff)) return yield* die("--handoff takes an https link without a user name or password, up to 2048 characters");
      const vendor = opt.vendor ?? new URL(opt.handoff).hostname;
      if (/steel/i.test(vendor) || /(^|\.)steel\.dev$/i.test(new URL(opt.handoff).hostname)) process.stderr.write("kiwi: steel live links are not authenticated; anyone with the link can use the tab\n");
      const seconds = opt.expires === undefined ? HANDOFF_DEFAULT_SECONDS : parseDuration(opt.expires);
      if (seconds < 1 || seconds > HANDOFF_MAX_SECONDS) return yield* die(`--expires must be between 1s and ${HANDOFF_MAX_SECONDS / 60}m`);
      const expiresAt = Date.now() + seconds * 1000;
      const head = opt.wait === undefined ? 0 : yield* s.ch.fx.head();
      const { seq, to } = yield* s.escalate(body, re, { url: opt.handoff, vendor: vendor.slice(0, HANDOFF_MAX_VENDOR), expiresAt });
      out(`escalated #${seq} to ${to.join(" and ")} with a browser link that opens for ${opt.expires ?? "10m"}; wait for their answer before acting on it`);
      if (opt.wait === undefined) return;
      const { outcome, replies } = yield* s.awaitHandoff(seq, head, expiresAt, parseDuration(opt.wait));
      for (const r of replies) out(render(r));
      if (outcome === "done") return;
      if (outcome === "waiting") return yield* die(`no answer to the handoff #${seq} within ${opt.wait}; the link is still open, so replies will still arrive when you listen`, 2);
      return yield* die(outcome === "failed" ? `the person couldn't finish the handoff #${seq}` : `no answer to the handoff #${seq} before it expired`, 4);
    }),

  icon: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (args[1] || opt.image || opt.clear) return yield* die(ADMIN_GONE);
      {
        const icon = yield* s.ch.fx.icon();
        if (!icon) return out("no icon (the owner sets one in the Kiwi app)");
        if (icon.kind === "emoji") return out(icon.emoji);
        const dir = joinPath(home(), "downloads", s.ch.roomId);
        mkdirSync(dir, { recursive: true });
        const path = joinPath(dir, `icon.${icon.mime.split("/")[1]}`);
        writeFileSync(path, Buffer.from(icon.data, "base64"));
        return out(`an image (${icon.mime}), saved at ${path}`);
      }
    }),

  thread: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi thread N"));
      const { messages, state } = yield* s.state();
      if (!(yield* s.message(seq, messages))) return yield* die(`no message #${seq}`);
      const root = state.threadOf.get(seq) ?? seq;
      for (const m of yield* s.threadMessages(root, messages, state)) if (!ignored(state.trust.get(m.seq))) out(render(m, state));
    }),

  /** One verb for hearing the channel: streams (tail); --once waits for the next (wait); --now doesn't wait (read); --webhook posts (watch). */
  listen: () => {
    if (opt.now && (opt.once || opt.timeout)) return die("--now doesn't wait: leave out --once and --timeout");
    // A timeout only makes sense for one wait: --timeout means --once.
    return opt.webhook ? commands.watch!() : opt.now ? commands.read!() : opt.once || opt.timeout ? commands.wait!() : commands.tail!();
  },

  /** Shared notes (facts): all of them, one, set one, or --clear one. */
  note: () => {
    const [key, ...rest] = args.slice(1);
    if (!key) return opt.clear || opt.ttl ? die("usage: kiwi note KEY --clear, or kiwi note KEY VALUE --ttl 7d") : commands.facts!();
    if (opt.clear) return commands.unset!();
    if (!rest.length && opt.ttl) return die("usage: kiwi note KEY VALUE --ttl 7d (a value to keep for that long)");
    return rest.length ? commands.set!() : commands.get!();
  },

  read: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const { messages, state } = yield* s.read(yield* delivery(s));
      for (const m of messages) out(render(m, state));
      yield* noteRead(s);
    }),

  tail: () =>
    Effect.gen(function* () {
      const s = yield* session();
      // Say what this agent runs on, so work that needs it finds it; never in the way of listening.
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
      // Say what this agent runs on, so work that needs it finds it; never in the way of listening.
      yield* Effect.forkDetach(Effect.ignoreCause(s.refreshCard(detectCard())));
      let got = 0;
      const enough = yield* Deferred.make<void>();
      const woke = Effect.suspend(() =>
        // Linger briefly so a burst of messages is delivered as one wake-up.
        got++ === 0 ? Effect.asVoid(Effect.forkScoped(Effect.andThen(Effect.sleep(400), Deferred.succeed(enough, undefined)))) : Effect.void,
      );
      const listening = s.listen((m, state) => Effect.andThen(Effect.sync(() => out(render(m, state))), woke), {
        ...(yield* delivery(s)),
        onStatus: (msg) => Effect.sync(() => void process.stderr.write(`kiwi: ${msg}\n`)),
        onNotice: (text) => Effect.andThen(Effect.sync(() => out(`* ${text}`)), woke),
      });
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
          // Whether it got there: a message the webhook didn't take isn't marked read.
          // A hung POST would freeze eachLive (uninterruptible) and the read cursor.
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
        // A webhook stands in for a person watching (a phone, CI): all chat unless narrowed.
        ...(yield* delivery(s)),
        ...(!opt["for-me"] && opt.thread === undefined ? { chat: true } : {}),
        onStatus: (msg) => Effect.sync(() => void process.stderr.write(`kiwi: ${msg}\n`)),
        onNotice: (text) =>
          Effect.sync(() => void fetch(url, { method: "POST", headers, body: JSON.stringify({ channel: s.alias, kind: "notice", text, ts: Date.now() }), signal: AbortSignal.timeout(10_000) }).catch(() => {})),
      });
    }),

  task: () =>
    oneLook(Effect.gen(function* () {
      const s = yield* session();
      // kiwi task alone: the board.
      if (!args[1]) return yield* commands.tasks!();
      const sub = args[1];
      const STATE_FOR: Record<string, TaskState> = { start: "doing", review: "review", done: "done" };
      if (sub === "add") {
        const title = yield* text(2);
        if (!title.trim()) return yield* die('usage: kiwi task add "title" [--owner NAME] [--review NAME|any] [--re N]');
        const re = opt.re === undefined ? undefined : Number(opt.re.replace(/^#/, "")) || (yield* die("--re takes a message number"));
        // Gone, and said so rather than refused, so an agent running older instructions still adds its task.
        for (const gone of ["after", "needs"] as const) if (opt[gone] !== undefined) process.stderr.write(`kiwi: --${gone} is gone (tasks don't wait on or match anything now); put it in the title or --detail\n`);
        const { state: before } = yield* s.state();
        const id = yield* s.taskAdd(title, { owner: opt.owner, detail: opt.detail, ...(opt.review !== undefined ? { review: opt.review } : {}), ...(re !== undefined ? { re } : {}) });
        const like = similarOpenTasks(before, title).map((t) => t.id);
        const lines = [`added ${taskId(id)}`];
        if (like.length) lines.push(looksLikeLine(like));
        return out(lines.join("\n"));
      }
      if (sub === "list") return yield* commands.tasks!();
      const id = yield* taskArg();
      if (sub === "show") {
        const { state } = yield* s.state();
        const shown = state.tasks.get(id) ?? (yield* die(`no task ${taskId(id)}`));
        return out(opt.json ? JSON.stringify(shown) : formatTask(state, shown));
      }
      if (sub === "match" || sub === "after") return yield* die(`kiwi task ${sub} is gone: tasks don't wait on or match anything now. Pick what you can do from the board (kiwi task)`);
      // Handing it over is giving it to someone with a note on where it stands (handoff is the older name).
      if (sub === "assign" || sub === "handoff") {
        const to = args[3] ?? (yield* die('usage: kiwi task assign T7 NAME ["where it stands, what\'s next"]'));
        const next = args.slice(4).join(" ") || opt.note || undefined;
        const state = yield* s.taskHandoff(id, to, next);
        const t = state.tasks.get(id)!;
        return out(`${taskId(id)} is ${t.owner}'s now${next ? "" : ' (add where it stands next time: kiwi task assign T7 NAME "…")'}`);
      }
      const verdictOf = { approve: "approved", reject: "rejected" } as const;
      const verdict = sub === "approve" || sub === "reject" ? verdictOf[sub] : undefined;
      const review = verdict && opt.file !== undefined ? yield* readText(opt.file) : undefined;
      if (review !== undefined && !review.trim()) return yield* die(`${opt.file} is empty`);
      const note = args.slice(3).join(" ") || opt.note || (review ? firstLine(review) : undefined) || undefined;
      const roundNo = opt.round === undefined ? undefined : /^[1-9]\d{0,8}$/.test(opt.round.trim()) ? Number(opt.round.trim()) : yield* die(`"${opt.round}" isn't a round number`);
      const judged = { ...(roundNo !== undefined ? { round: roundNo } : {}), ...(opt.at?.trim() ? { at: opt.at.trim() } : {}) };
      let state: ChannelState;
      if (sub === "claim") state = yield* s.taskClaim(id);
      else if (sub === "review") state = yield* s.taskUpdate(id, { state: "review", note, ...(opt.review !== undefined ? { review: opt.review } : {}), ...(opt.at?.trim() ? { at: opt.at.trim() } : {}) });
      else if (sub === "approve") state = yield* s.taskUpdate(id, { state: "done", verdict: "approved", note, ...judged }, review);
      else if (sub === "reject") state = yield* s.taskUpdate(id, { state: "doing", verdict: "rejected", note: note ?? (yield* die('usage: kiwi task reject T7 "what needs to change" (or --file review.md)')), ...judged }, review);
      else if (sub in STATE_FOR) state = yield* s.taskUpdate(id, { state: STATE_FOR[sub], note });
      // Blocked (an older name) is a note on work in progress; cancelling finishes it, marked cancelled.
      else if (sub === "block") state = yield* s.taskUpdate(id, { note: `blocked${note ? `: ${note}` : ""}` });
      else if (sub === "cancel") state = yield* s.taskUpdate(id, { state: "cancelled", note });
      else if (sub === "drop") state = yield* s.taskUpdate(id, { owner: null, note });
      else if (sub === "note") state = yield* s.taskUpdate(id, { note: note ?? (yield* die('usage: kiwi task note T7 "…"')) });
      else return yield* die(`unknown task command "${sub}"`);
      const t = state.tasks.get(id)!;
      out(`${taskId(id)} ${taskStateWord(t)}${t.owner ? ` @${t.owner}` : ""}: ${inlineText(t.title, 200)}`);
    })),

  tasks: () =>
    Effect.gen(function* () {
      if (opt.global) {
        const keys = yield* Keystore;
        const cfg = yield* keys.config;
        const aliases = Object.keys(cfg.channels).sort();
        if (!aliases.length) return yield* die("no channels yet (see: kiwi join)");
        // Only channels the acting agent is in itself: another local agent's keys are not ours to use.
        const me = opt.as ?? process.env.KIWI_AS ?? bindingFor(process.cwd())?.as ?? (yield* die("--global needs to know who you are: pass --as NAME, or run it from your bound folder"));
        yield* keepDaemon;
        for (const alias of aliases) {
          const c = cfg.channels[alias]!;
          if (!(yield* keys.identitiesIn(c.roomId)).includes(me)) continue;
          const sess = yield* openSession(alias, c, me);
          const { state } = yield* sess.state();
          const owner = opt.mine ? sess.me : opt.owner;
          const lines = formatTasks(state, { all: opt.all, owner });
          out(`## ${alias}${lines === "no tasks" ? " — no tasks" : ""}`);
          if (lines !== "no tasks") out(lines.split("\n").map((l) => `  ${l}`).join("\n"));
        }
        return;
      }
      const s = yield* session();
      const { state } = yield* s.state();
      out(formatTasks(state, { all: opt.all, owner: opt.mine ? s.me : opt.owner }));
    }),

  // Claims are gone. Agents running older instructions still call these: say so, and carry on.
  claim: () => Effect.sync(() => out(CLAIMS_GONE)),
  release: () => Effect.sync(() => out(CLAIMS_GONE)),
  claims: () => Effect.sync(() => out(CLAIMS_GONE)),

  set: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [key, ...rest] = args.slice(1);
      if (!key || !rest.length) return yield* die("usage: kiwi set KEY VALUE [--ttl 7d]");
      const value = rest.join(" ");
      const ttl = opt.ttl ? parseDuration(opt.ttl) : undefined;
      yield* s.setFact(key, value, ttl);
      out(ttl ? `${key} = ${value} (for ${opt.ttl})` : `${key} = ${value}`);
    }),

  get: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const key = args[1] ?? (yield* die("usage: kiwi get KEY"));
      const f = (yield* s.state()).state.facts.get(key);
      if (!f) return yield* die(`no fact "${key}"`, 2);
      out(f.value);
    }),

  unset: () =>
    Effect.gen(function* () {
      const s = yield* session();
      yield* s.delFact(args[1] ?? (yield* die("usage: kiwi unset KEY")));
    }),

  facts: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const { facts } = (yield* s.state()).state;
      if (!facts.size) return out("no facts");
      for (const f of [...facts.values()].sort((a, b) => a.key.localeCompare(b.key))) out(formatFact(f));
    }),

  /** Say what this agent runs on and has, so work that needs it finds it. */
  card: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const { sent, card } = yield* s.refreshCard(detectCard(), { ...(opt.model ? { model: opt.model } : {}), ...(opt.note ? { note: opt.note } : {}), ...(opt.tools ? { tools: list(opt.tools) } : {}) });
      out(`${sent ? "card" : "card unchanged"}: ${cardLine(card)}`);
    }),

  hello: () =>
    Effect.gen(function* () {
      const s = yield* session();
      // Roles aren't asked for: the owner sets them in the Kiwi app.
      if (opt.role || opt.about) return yield* die("the owner sets roles and rules: ask them in a message (kiwi send --to human \"…\")");
      yield* s.hello();
      const me = (yield* s.state()).state.members.get(s.me);
      out(`announced ${s.me}${me?.role ? ` as ${me.role}` : ""}`);
    }),
  prompt: () =>
    Effect.gen(function* () {
      const alias = yield* channelAlias();
      const cfg = (yield* config).channels[alias];
      const name = yield* agentName(cfg);
      if (cfg) yield* keepDaemon;
      // What the channel says about it, if the relay answers; the prompt doesn't wait on it otherwise.
      const state = cfg
        ? yield* Effect.flatMap(openSession(alias, cfg, name), (s) => s.state()).pipe(
            Effect.map(({ state }) => state),
            Effect.catchCause(() => Effect.succeed(null)),
          )
        : null;
      const me = state?.members.get(name);
      out(
        agentPrompt(
          alias,
          name,
          state ? { scopes: me?.scopes, hold: holdLine(state), charter: charterLines(state), mode: modeLine(state, name), human: humanOf(state, name), role: me?.role, about: me?.about } : {},
        ),
      );
    }),
  mcp: () =>
    Effect.gen(function* () {
      const { runMcp } = yield* Effect.promise(() => import("../mcp.ts"));
      yield* runMcp(yield* session(), { push: opt.push });
    }),

  relay: () =>
    Effect.gen(function* () {
      const { runRelay } = yield* Effect.promise(() => import("../relay/bun.ts"));
      runRelay(process.argv.slice(3), "kiwi relay");
      return yield* Effect.never;
    }),

  demo: () =>
    Effect.gen(function* () {
      const { demo } = yield* Effect.promise(() => import("../demo.ts"));
      // A checkout with the dashboard built serves it too; the binary has the terminal tour.
      const built = joinPath(import.meta.dir, "../../web/dist");
      yield* demo({ stay: !!opt.stay, ...(existsSync(joinPath(built, "index.html")) ? { web: built } : {}), ...(opt.n ? { pace: Number(opt.n) } : {}) });
    }),

  doctor: () =>
    Effect.gen(function* () {
      const { doctor } = yield* Effect.promise(() => import("./doctor.ts"));
      return yield* doctor();
    }),
};

function wakeLine(w: DaemonSeat["wake"]): string {
  const how = w.path.kind === "hooks" ? `wakes via ${wakeWords("hooks")}` : w.path.kind === "command" ? `wakes via ${wakeWords(w.path.via)}` : `can't be woken: ${w.path.why}`;
  const last = w.last ? ` · last wake ${ago(w.last.at)} via ${wakeWords(w.last.via)}, ${w.last.unread} unread, ${w.last.ok ? "ok" : "failed"}` : "";
  return `wake ${w.on ? "on" : "off"} · ${how}${last}`;
}

function listenLine(mc: string, alias: string, agent: string): string {
  return howMessagesReachYou(mc, wakeOn(loadConfig(), alias, agent));
}

/** What an agent reads when it gets in (brief.ts): who it is, who directs it, how messages reach it, and where the rest is. */
export function joinedText(
  alias: string,
  agent: string,
  as: { scopes?: readonly Scope[]; hold?: string | null; charter?: string | null; mode?: string | null; human?: string | null; role?: string; about?: string } = {},
): string {
  const mc = mcFor(alias, agent);
  return briefText({ alias, agent, mc, listen: listenLine(mc, alias, agent), ...as });
}

/** `kiwi prompt`: the same brief, to paste into an agent that didn't join from here. */
export function agentPrompt(
  alias: string,
  agent: string,
  as: { role?: string; about?: string; scopes?: readonly Scope[]; human?: string | null; hold?: string | null; charter?: string | null; mode?: string | null } = {},
): string {
  return joinedText(alias, agent, as);
}

/** Stop: `kiwi: <message>` on stderr, and this exit code. */
function stop(message: string, code = 1): never {
  process.stderr.write(`kiwi: ${message}\n`);
  process.exit(code);
}

/**
 * What a command failed with, as the line and exit code it has always been: a Quit says its own;
 * gone (closed or removed) forgets what this command acted for and exits 4; the relay's refusals
 * are prefixed `relay:`; anything else (this client's own refusals, a relay out of reach) is its text.
 */
const fail = (cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const err = Cause.squash(cause);
    if (err instanceof Quit) return stop(err.message, err.code);
    if (err instanceof ChannelGone) {
      // Forget only what this command was acting for. Closed: the channel is gone for
      // everyone, so all of it goes. Removed: just this agent; others here keep theirs.
      const keys = yield* Keystore;
      if (acting.alias && err.why === "closed") yield* keys.wipeChannel(acting.alias);
      else if (acting.alias && acting.name) yield* keys.forgetMember(acting.alias, acting.name);
      return stop(goneText(err, acting.alias, acting.name), 4);
    }
    if (err instanceof RelayError) return stop(`relay: ${err.message}`);
    return stop(reason(err));
  });

if (import.meta.main) {
  const cmd = opt.version ? "version" : args[0];
  if (cmd === "version") {
    out(VERSION);
    process.exit(0);
  }
  if (!cmd || opt.help || cmd === "help") {
    out(HELP);
    process.exit(0);
  }
  const shortcuts: Record<string, string> = { s: "status", t: "tasks" };
  const command = commands[shortcuts[cmd] ?? cmd];
  if (command && cmd !== "daemon" && cmd !== "relay" && cmd !== "hook") await refreshListeners();
  // One runtime for the whole command: the relay over HTTP, and this computer's files.
  const runtime = ManagedRuntime.make(AgentLive);
  const exit = await runtime.runPromiseExit(command ? command() : die(`unknown command "${cmd}" (see: kiwi help)`));
  if (Exit.isFailure(exit)) await runtime.runPromise(fail(exit.cause));
  else if (cmd !== "mcp" && cmd !== "relay") process.exit(exit.value ?? 0);
}
