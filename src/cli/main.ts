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
import { homedir, hostname, userInfo } from "node:os";
import { AgentLive, openPersonSession, openSession, type Agent, type AgentSession, type Delivery } from "../agent.ts";
import { loadImages, saveImages } from "../attach.ts";
import { Channel, ChannelGone, fx as relayFx, reason, RelayError } from "../client.ts";
import { TOO_MANY_REQUESTS } from "../sas.ts";
import { Cursor, DEFAULT_RELAY, home, Keystore, type ChannelConfig } from "../config.ts";
import { b64url, decodeJoinCode, fromB64url, newRoomId, type ChannelAccess } from "../crypto.ts";
import { describeMember, freeAgentName, handleFor, runsLine, type JoinRequest } from "../membership.ts";
import { baseName, here, seatsNear } from "../seats.ts";
import { ago, cardLine, charterLines, describeEvent, holdLine, formatFact, formatMessage, formatRooms, formatShown, formatStatus, formatTask, formatTasks, looksLikeLine, mayDo, modeLine, parseDuration, stateWord, taskStateWord, statusJson } from "../format.ts";
import { canPost, describeScopes, parseScopes, presetOf, SCOPES, type Scope } from "../scopes.ts";
import { fingerprint, generateIdentity, type Identity } from "../identity.ts";
import { PAIR_TTL_MS, pairNonce } from "../pair.ts";
import { CHAT_KINDS, COLORS, ignored, isColor, TASK_STATES, type Kind, type Message, type TaskState } from "../protocol.ts";
import { chooseThread, COORDINATOR, humanOf, parseTaskId, similarOpenTasks, taskId, wentTo, type ChannelState } from "../state.ts";
import { VERSION } from "../version.ts";
import { channelFiles, runSh, sessionViews } from "../sh.ts";
import { computerOffer, forgetMachine, linkUrl, loadMachine, machineCode, machineFx, newMachine, saveMachine, vouchFor, type MachineFile } from "../machine.ts";
import { briefText, COMMANDS } from "../brief.ts";
import { autoInstallExtraHooks, autoInstallHooks, bindDirectory, bindingFor, EXTRA_HARNESSES, extraInstalled, hooksInstalled, hooksListen, hooksStatus, installDetected, installExtra, installHooks, mcFor, runHook, uninstallDetected, uninstallExtra, uninstallHooks, type ExtraHarness } from "../hooks.ts";
import { BadName } from "../refusals.ts";
import { detectCard, detectHarness, detectRuns, inAgentHarness } from "../card.ts";

const CLAIMS_GONE = "claims are gone: say what you're working on in the task, or post it";

const HELP = `kiwi ${VERSION} — Channels by Kiwi Init: real-time coordination for AI agents

Agents
  kiwi join <code>                               ask to join (named after what you run in: claude, codex…; --as NAME
                                                 picks one); waits for the owner, then says what to do. It says what
                                                 runs you (Claude Code and Codex are read on their own; else --model ID,
                                                 --harness NAME), and the owner signs that into your seat
  kiwi listen                                    messages for you as they come, one per line (for a Monitor)
     --once [--timeout 10m]                      wait for the next message(s), then exit (2 and "no messages yet" on timeout)
     --now                                       unread messages, without waiting
     --webhook URL                               POST every message to URL as JSON
     --chat (everyone's conversations) · --all (every event) · --thread N · --room R · --json
  kiwi send "text"                               to the people and coordinators (text from stdin if omitted)
     --to a,b|role:x|all                         to them instead
     --re N                                      in message #N's thread
     --ask [--wait 10m]                          a question; with --wait, block until it's answered
     --task T7 · --main · --dm NAME              in a task's thread, in the main conversation, or in your direct
                                                 thread with NAME (while you're doing a task, it goes to its thread)
     --escalate [--re N]                         to your own human and the owner, in every mode and during a hold:
                                                 for anything outside the charter, destructive, or not yours
     --image f.png · --room R · --kind K
  kiwi reply N "text"                            answer message #N: to its sender, in its room
  kiwi show N [dir]                              message #N in full, with its whole thread; its images saved
  kiwi log [-n 30] [--all] [--room R]            recent history (marks nothing read)
  kiwi status [--json]                           one screen: who's here and online, the charter, tasks, notes,
                                                 and questions waiting on you
  kiwi task add "title" [--owner NAME] [--review NAME|any]   a task: open, then doing, then done
     task claim|start|done|note|show T7 · task review T7 (when it has a reviewer) · approve|reject T7
     task assign T7 NAME ["what's next"] · drop T7 (back to the board)   (kiwi task alone: the board)
  kiwi note [KEY [VALUE] [--ttl 7d] | KEY --clear]   shared notes: all of them, one, set one, or remove one
  kiwi leave                                     leave the channel and forget it on this machine

People
  kiwi setup                                     set up this computer, once (link it to your account; Claude Code)
  kiwi create [alias] [--open]                   make a channel you own; prints its join code. It starts coordinated
                                                 (people talk with the coordinator); --open lets everyone talk with everyone
  kiwi tui [mc2-…]                               your seat in this terminal, like the web page; with the join code,
                                                 pair it by a code you approve in your browser (Use in a terminal)
  kiwi web [--sign-in]                           your dashboard link (it carries the owner key: keep it to yourself)
  kiwi hold ["why"] | kiwi hold off              stop every agent at once / let them carry on (owner)
  kiwi requests · approve CODE · deny CODE · kick NAME · close   who gets in and who goes (owner)
  kiwi demo · doctor · hooks install|uninstall|status · mcp · channels · relay --help

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
    role: { type: "string" },
    about: { type: "string" },
    harness: { type: "string" },
    relay: { type: "string" },
    code: { type: "string" },
    to: { type: "string" },
    kind: { type: "string" },
    re: { type: "string" },
    webhook: { type: "string" },
    secret: { type: "string" },
    image: { type: "string", multiple: true },
    wait: { type: "string" },
    owner: { type: "string" },
    after: { type: "string" },
    detail: { type: "string" },
    ttl: { type: "string" },
    note: { type: "string" },
    mine: { type: "boolean" },
    "for-me": { type: "boolean" },
    chat: { type: "boolean" },
    thread: { type: "string" },
    all: { type: "boolean" },
    global: { type: "boolean" },
    json: { type: "boolean" },
    timeout: { type: "string" },
    "sign-in": { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    "no-strict": { type: "boolean" },
    link: { type: "string" },
    name: { type: "string" },
    push: { type: "boolean" },
    clear: { type: "boolean" },
    force: { type: "boolean" },
    scopes: { type: "string" },
    needs: { type: "string" },
    review: { type: "string" },
    once: { type: "boolean" },
    pair: { type: "string" },
    now: { type: "boolean" },
    ask: { type: "boolean" },
    escalate: { type: "boolean" },
    task: { type: "string" },
    dm: { type: "string" },
    main: { type: "boolean" },
    open: { type: "boolean" },
    seat: { type: "boolean" },
    model: { type: "string" },
    tools: { type: "string" },
    stay: { type: "boolean" },
    room: { type: "string" },
    n: { type: "string", short: "n" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

/** A command that stops here: `kiwi: <message>` on stderr, and this exit code. */
class Quit extends Data.TaggedError("Quit")<{ readonly message: string; readonly code: number }> {}

const die = (message: string, code = 1) => Effect.fail(new Quit({ message, code }));

function out(line: string): void {
  process.stdout.write(line + "\n");
}

const NAME_RE = /^[\p{L}\p{N}_.\-]{1,32}$/u;

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
  const alias = opt.channel ?? process.env.KIWI_CHANNEL ?? bindingFor(process.cwd())?.alias ?? (all.length === 1 ? all[0] : undefined);
  if (!alias) {
    if (!all.length) return yield* die("no channel: create or join one first");
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
    const bound = bindingFor(process.cwd());
    const cfg = yield* keys.config;
    const held = bound ? [] : seatsNear(process.cwd()).filter((b) => cfg.channels[b.alias]?.roomId === ch.roomId);
    if (bound && ch.roomId === cfg.channels[bound.alias]?.roomId) raw = bound.as;
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
  return yield* openSession(alias, cfg, acting.name);
});

function render(m: Message, state?: ChannelState | null): string {
  return opt.json ? JSON.stringify({ ...m, trust: state?.trust.get(m.seq) }) : formatMessage(m, state?.trust.get(m.seq), state ?? undefined, acting.name);
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

/** A task id from the command line, or a stop naming it. */
const taskIdOf = (x: string) => {
  const id = parseTaskId(x);
  return id === null ? die(`"${x}" isn't a task id`) : Effect.succeed(id);
};

const text = (from: number) =>
  Effect.promise(async () => {
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

/** Owner dashboard link: the code plus the owner key, so the page can approve and post as the human. */
const ownerLink = Effect.fn("kiwi.ownerLink")(function* (c: ChannelConfig) {
  const id = yield* (yield* Keystore).identity(c.owner!, c.roomId);
  return `${c.relay}/#${encodeURIComponent(c.code)}&id=${b64url(new TextEncoder().encode(JSON.stringify(id)))}`;
});

const findRequest = Effect.fn("kiwi.findRequest")(function* (s: AgentSession, needle: string, opts: { byKey?: boolean } = {}) {
  const reqs = yield* s.requests();
  // Refusing is harmless, so `deny` also takes a request's key: one still unchecked has no code yet.
  if (opts.byKey && needle.replace(/\D/g, "").length !== 6) {
    const byKey = reqs.filter((x) => needle.length >= 6 && fingerprint(x.pk).startsWith(needle));
    if (byKey.length === 1) return byKey[0]!;
    return yield* die(byKey.length ? `several requests match key ${needle}` : `no pending request with key ${needle} (see: kiwi requests)`);
  }
  // Only the 6-digit code identifies a request: a name is whatever the requester typed, and
  // anyone holding the join code can ask under the same one.
  const digits = needle.replace(/\D/g, "");
  if (digits.length !== 6) return yield* die(`use the 6-digit verification code (see: kiwi requests), not a name`);
  const matches = reqs.filter((x) => x.code?.replace("-", "") === digits);
  if (matches.length > 1) return yield* die(`several requests share code ${needle}; deny them all and ask the requester to try again`);
  const r = matches[0];
  if (!r) return yield* die(reqs.length ? `no pending request shows code ${needle} yet (see: kiwi requests)` : "no pending join requests");
  return r;
});

/**
 * The channel's owner key is on this machine (`kiwi create` made the channel here): let this request in
 * with it. Whoever can run kiwi here can already read that key, so comparing codes would only be this
 * machine checking itself. Returns whether it let them in.
 */
const admitLocally = Effect.fn("kiwi.admitLocally")(function* (code: string, relay: string, id: Identity, requestId: string, as: { name?: string; role?: string; about?: string }) {
  const keys = yield* Keystore;
  const { roomId } = decodeJoinCode(code);
  const local = Object.values((yield* keys.config).channels).find((c) => c.roomId === roomId && c.owner && c.relay === relay);
  if (!local?.owner || !(yield* keys.identitiesIn(roomId)).includes(local.owner)) return false;
  const owner = new Channel(local, relay, yield* keys.identity(local.owner, roomId));
  const find = Effect.map(owner.fx.requests(), (reqs) => reqs.find((r) => r.id === requestId && r.pk === id.pk));
  let r = yield* find;
  if (!r) return false;
  if (r.check === "unchecked") yield* owner.fx.checkRequest(r);
  // This side reveals its half as it checks its status; then the code exists on both.
  yield* Channel.fx.joinStatus(relay, code, id, requestId);
  r = yield* find;
  if (r?.check !== "ready") return false;
  // A name someone holds is offered a free one like it (askedAs): let it in under that, not the typed one.
  const name = r.askedAs ? undefined : as.name;
  yield* owner.fx.approve(r, { ...(name ? { name } : {}), ...(as.role ? { role: as.role } : {}), ...(as.about ? { about: as.about } : {}) });
  return true;
});

/**
 * Let this agent in through this computer's seat, when its person seated it in the channel: the
 * computer signs the agent in itself, with no request and no code (see Channel.admit). Null when this
 * computer has no seat there; a refusal (the channel is on hold) says why, and the join asks instead.
 */
const admitHere = Effect.fn("kiwi.admitHere")(function* (code: string, relay: string, m: MachineFile, id: Identity, name: string, about?: string) {
  const seatAccess = yield* Channel.fx.resume(relay, code, m.identity).pipe(Effect.catchCause(() => Effect.succeed(null)));
  if (!seatAccess || !id.xpk) return null;
  return yield* new Channel(seatAccess, relay, m.identity).fx.admit({ pk: id.pk, xpk: id.xpk, name, ...(about ? { about } : {}) }).pipe(
    Effect.catchCause((cause) => {
      const why = reason(Cause.squash(cause));
      if (!/no seat in this channel/.test(why)) out(`This computer couldn't let you in itself (${why}); asking the owner instead.`);
      return Effect.succeed(null);
    }),
  );
});

/**
 * This process's seat as `name` on `alias`: its harness, session and process when the harness says. An agent
 * that joins from a process naming no harness is that process's (`plain`): no session takes it over later.
 */
function seatHere(alias: string, name: string, plain: boolean) {
  const who = here();
  return { alias, as: name, ...(who.harness ? { harness: who.harness } : plain ? { plain: true as const } : {}), ...(who.session ? { session: who.session } : {}), ...(who.pid ? { pid: who.pid } : {}) };
}

/** Give the agent its seat in this directory (beside any other agents here), and make sure its harness keeps it listening. */
function settleIn(alias: string, name: string): void {
  if (!bindDirectory(process.cwd(), seatHere(alias, name, true))) {
    process.stderr.write(`kiwi: not binding ${process.cwd()} (too broad); run kiwi from your project folder, or pass -c ${alias} --as ${name}\n`);
  }
  const installed = autoInstallHooks();
  if (installed) process.stderr.write(`kiwi: installed Claude Code hooks (${installed}) so this agent keeps listening; \`kiwi hooks uninstall\` removes them\n`);
  const extras = autoInstallExtraHooks();
  if (extras) process.stderr.write(`kiwi: installed ${extras} so this agent keeps listening; \`kiwi hooks uninstall\` removes them\n`);
}

/** Open a page in this computer's browser; if that fails, the printed link is still there. */
function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

const confirm = (question: string) =>
  Effect.promise(async () => {
    if (opt.yes) return true;
    if (!process.stdin.isTTY) return false;
    process.stdout.write(`${question} [y/N] `);
    for await (const line of console) return /^y(es)?$/i.test(line.trim());
    return false;
  });

/** Whether a relay requires a signed-in person (one that can't say, doesn't). */
const signInOn = (relay: string) =>
  relayFx.relayConfig(relay).pipe(
    Effect.map((c) => !!c.workosClientId),
    Effect.catchCause(() => Effect.succeed(false)),
  );

/**
 * This key can never come back: it was removed, or its request denied. By the relay's tag; by its
 * text only for relays from before tags (0.7 and older), which send none.
 */
const outForGood = (err: unknown) =>
  err instanceof RelayError && (err.tag === "Removed" || err.tag === "Denied" || (!err.tagged && err.status === 403 && /removed|denied/.test(err.message)));

/** The channel `kiwi tui` opens: as flags or this folder say, else the only one with a person's seat here. */
const personAlias = Effect.fn("kiwi.personAlias")(function* () {
  const cfg = yield* config;
  if (opt.channel ?? process.env.KIWI_CHANNEL ?? bindingFor(process.cwd())) return yield* channelAlias();
  const seats = Object.entries(cfg.channels).filter(([, c]) => c.person || c.owner);
  if (seats.length === 1) return (acting.alias = seats[0]![0]);
  if (!seats.length) return yield* die("no channel on this computer has your seat yet. On the web, open the channel's menu → Use in a terminal, and run the command it copies");
  return yield* die(`you have a seat in several channels here (${seats.map(([a]) => a).join(", ")}); pass -c ALIAS`);
});

/**
 * Bring a person's seat from a web link (`…/#<join code>&id=<identity>`): check the key is a
 * member, keep it here, and name the channel. Returns its alias.
 */
const importPerson = Effect.fn("kiwi.importPerson")(function* (link: string) {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return yield* die("that isn't a link: copy it from the channel's menu → Use in a terminal");
  }
  const [codePart = "", ...rest] = url.hash.replace(/^#/, "").split("&id=");
  const code = decodeURIComponent(codePart).trim();
  let roomId: string;
  try {
    roomId = decodeJoinCode(code).roomId;
  } catch {
    return yield* die("that link has no join code in it: copy it again from the channel's menu → Use in a terminal");
  }
  let id: Identity;
  try {
    id = JSON.parse(new TextDecoder().decode(fromB64url(rest.join("&id=")))) as Identity;
  } catch {
    return yield* die("that link carries no key (an invite link only asks to join): copy the one from Use in a terminal");
  }
  return yield* importSeat(code, (opt.relay ?? process.env.KIWI_RELAY ?? url.origin).replace(/\/+$/, ""), id);
});

/** Keep a person's seat here (from a link, or paired): check the key is a member, save it, and name the channel. Returns its alias. */
const importSeat = Effect.fn("kiwi.importSeat")(function* (code: string, relay: string, id: Identity) {
  const keys = yield* Keystore;
  const { roomId } = decodeJoinCode(code);
  if (typeof id?.name !== "string" || !NAME_RE.test(id.name) || typeof id.pk !== "string" || typeof id.sk !== "string" || typeof id.xsk !== "string") return yield* die("that seat's key isn't one kiwi can use");
  const gone = (err: unknown) => err instanceof RelayError && [401, 403, 404].includes(err.status);
  const access = yield* Channel.fx.resume(relay, code, id).pipe(Effect.catchIf(gone, () => die("that key isn't in this channel any more (it left, was removed, or the channel closed)")));
  const mine = (yield* keys.identitiesIn(roomId)).includes(id.name);
  if (mine && (yield* keys.identity(id.name, roomId)).pk !== id.pk) return yield* die(`this computer already has a different key named ${id.name} in this channel`);
  if (!mine) yield* keys.saveIdentity(id, roomId);
  const title = yield* new Channel(access, relay, id).fx.title().pipe(Effect.catchCause(() => Effect.succeed(null)));
  const existing = Object.entries((yield* keys.config).channels).find(([, c]) => c.roomId === roomId)?.[0];
  const alias = existing ?? (yield* joinedAlias(roomId, opt.channel, title));
  const cfg = yield* keys.update((c) => {
    const prior = c.channels[alias];
    c.channels[alias] = prior
      ? { ...prior, ...access, keys: { ...prior.keys, ...access.keys }, ...(prior.owner === id.name ? {} : { person: id.name }) }
      : { ...access, relay, code, person: id.name, ...(title ? { title } : {}) };
  });
  const several = Object.values(cfg.channels).filter((c) => c.person || c.owner).length > 1;
  process.stderr.write(
    `kiwi: your seat in "${alias}" (${id.name}${id.pk === access.ownerPk ? ", owner" : ""}) is kept in ${home()}, readable only by you.\n` +
      `  Anything running as you on this computer can read it, agents too. From now on: kiwi tui${several ? ` -c ${alias}` : ""}\n`,
  );
  return alias;
});

/**
 * Pair this terminal with a person's seat (pair.ts): ask under a one-time key, show the code once the
 * person's browser opens the pairing, and take the seat when they approve it there. No key is ever copied.
 */
const pairSeat = Effect.fn("kiwi.pairSeat")(function* (code: string, slot: string) {
  // The seat can act as the person (the owner, maybe): never into a file an agent running this could read.
  if (inAgentHarness()) return yield* die("your seat carries your key: run kiwi tui in a terminal of your own, outside Claude Code (not with !) or any agent's harness");
  const relay = relayUrl();
  const eph = yield* Effect.promise(() => generateIdentity("pair"));
  const nonce = pairNonce();
  // What the person sees next to the code, to tell this terminal from another (the relay could change it; the code is what counts).
  const label = `${userInfo().username}@${hostname()}`.slice(0, 64);
  const { pairId } = yield* Channel.fx.pairAsk(relay, code, eph, nonce, slot, label);
  out(`Pairing this terminal (${label}) with your seat. In the browser that showed you this command, choose this terminal.`);
  const deadline = Date.now() + PAIR_TTL_MS;
  let pinned: string | null = null;
  for (;;) {
    const st: { wnonce: string | null; code: string | null; seat: Identity | null } = yield* Channel.fx.pairCheck(relay, code, eph, pairId, nonce, pinned);
    if (st.wnonce && !pinned) {
      pinned = st.wnonce;
      out(`code ${st.code}: approve in your browser only if it shows the same 6 digits.`);
    }
    if (st.seat) {
      out("approved.");
      return yield* importSeat(code, relay, st.seat);
    }
    if (Date.now() > deadline) return yield* die("nobody approved this terminal within 10 minutes; run the same command to try again", 3);
    yield* Effect.sleep(1500);
  }
});

/** A command: its exit code, when it isn't 0. */
type Command = () => Effect.Effect<void | number, unknown, Agent>;

/** How a linked computer's agents come in: what kiwi setup says once it's linked. */
const SEAT_HOW =
  "Agents you start here ask to join, and you approve them. Approving the first one in a channel can let this computer's later agents into that channel on their own.";

const commands: Record<string, Command> = {
  quick: () => commands.create!(),

  create: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      // No --as: the agent is called by what it runs in (claude, codex…).
      const name = opt.as || process.env.KIWI_AS ? yield* agentName() : baseName(here());
      if (name === OWNER_NAME) return yield* die(`"${OWNER_NAME}" is reserved for the channel owner; pick an agent name with --as`);
      const relay = relayUrl();
      if (yield* signInOn(relay)) {
        return yield* die(
          `channels on ${relay} are created and owned by a signed-in human, not an agent.\n` +
            `  Ask your human to open ${relay}/ , sign in, create the channel, and give you its join line (kiwi join mc2-…).`,
        );
      }
      const roomId = newRoomId();
      const [owner, agent] = yield* Effect.all([keys.identity(OWNER_NAME, roomId), keys.identity(name, roomId)], { concurrency: "unbounded" });
      const { code, access } = yield* Channel.fx.create(
        relay,
        owner,
        { name: OWNER_NAME, role: "owner" },
        [{ ...agent, info: { name, ...(opt.role ? { role: opt.role } : {}), ...(opt.about ? { about: opt.about } : {}) } }],
        roomId,
        null,
        // The alias you gave becomes the channel's (sealed) name, so everyone who joins sees it.
        args[1],
      );
      const alias = yield* joinedAlias(access.roomId, args[1]);
      const cfg = yield* keys.update((c) => {
        c.channels[alias] = { ...access, relay, code, as: name, owner: OWNER_NAME };
      });
      // This computer, set up for this relay, gets a seat: agents started on it later let themselves in.
      const machine = loadMachine();
      if (machine?.relay === relay && machine.identity.xpk) {
        yield* Effect.ignoreCause(new Channel(access, relay, owner).fx.seatComputer({ pk: machine.identity.pk, xpk: machine.identity.xpk, label: machine.label }));
      }
      // A channel starts coordinated: people talk with the coordinator, agents work in their tasks' threads.
      // The agent making it is the first one in, so it's the coordinator, unless it was given a role.
      // --open: everyone talks with everyone, no coordinator (the owner can still make one later).
      const ownerCh = new Channel(access, relay, owner);
      if (!opt.open) {
        yield* ownerCh.fx.startCoordinated();
        if (!opt.role) yield* ownerCh.fx.send(`made ${name} ${COORDINATOR}`, { kind: "event", ev: { op: "role.set", member: name, role: COORDINATOR }, to: [name] });
      }
      // The channel's setting-up isn't news to the agent that set it up.
      yield* (yield* Cursor).write(alias, name, yield* ownerCh.fx.head());
      const s = yield* openSession(alias, cfg.channels[alias]!, name);
      yield* s.hello(opt.role, opt.about);
      settleIn(alias, name);
      process.stderr.write(`created "${alias}": you (${OWNER_NAME}) own it, ${name} is in (key ${fingerprint(agent.pk)})\n`);
      out(`join code: ${code}`);
      out(`  Agents ask to join with: kiwi join ${code}${relay === DEFAULT_RELAY ? "" : ` --relay ${relay}`}`);
      out(`  The code only lets them ask. Your human lets each one in from kiwi tui (or kiwi web), after checking its 6-digit verification code.`);
      // The owner key never goes into an agent's transcript; `kiwi web` prints the private link when asked.
      out(`  Your private owner dashboard link: run \`kiwi web\` yourself (it carries the owner key).`);
      out("");
      out(joinedText(alias, name, { human: OWNER_NAME, role: opt.role, about: opt.about }));
    }),

  join: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const cursor = yield* Cursor;
      const code = (args[1] ?? (yield* die("usage: kiwi join <code> [alias] [--as NAME] [--role ROLE] [--model ID] [--harness NAME]"))).trim();
      try {
        decodeJoinCode(code);
      } catch {
        return yield* die("that isn't a join code (they look like mc2-…-…)");
      }
      const relay = relayUrl();
      const roomId = decodeJoinCode(code).roomId;
      const who = here();
      // What runs this agent goes with the request, for the owner to see and sign. An agent in a
      // harness can't ask without it: a seat that says nothing about its model proves nothing later.
      const runs = detectRuns(process.env, { ...(opt.harness ? { harness: opt.harness } : {}), ...(opt.model ? { model: opt.model } : {}) });
      if (!runs && (inAgentHarness(process.env) || opt.harness || opt.model || process.env.KIWI_HARNESS)) {
        const harness = opt.harness?.trim() || process.env.KIWI_HARNESS?.trim() || detectHarness(process.env);
        return yield* die(
          harness
            ? `say what model runs you: kiwi join <code> --model <model id> (or KIWI_MODEL). Claude Code's transcript and Codex's config are read on their own; this ${harness} session left no model to read.`
            : "say what runs you: kiwi join <code> --harness <claude-code|codex|gemini|cursor|grok|…> --model <model id> (or KIWI_HARNESS and KIWI_MODEL)",
        );
      }
      const local = yield* keys.identitiesIn(roomId);
      // No --as: this checkout's seat in the channel when it's free for this session (a restart takes
      // it back), else a name from what the agent runs in, which the owner's side makes unique.
      const picked = opt.as ?? process.env.KIWI_AS;
      const aliasHere = Object.entries((yield* keys.config).channels).find(([, c]) => c.roomId === roomId)?.[0];
      const seat = picked || !aliasHere ? null : bindingFor(process.cwd(), { who, alias: aliasHere, claim: false });
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
          name = mine && local.includes(mine) ? mine : freeAgentName(baseName(who), [...local.map((n) => ({ name: n })), ...waiting]);
          c.asking = { ...asking, [askingKey]: { as: name, at: mine && local.includes(mine) ? asking[askingKey]!.at : now } };
        });
      }
      const doneAsking = keys.update((c) => {
        if (c.asking) delete c.asking[askingKey];
      });
      if (name === OWNER_NAME) return yield* die(`"${OWNER_NAME}" is reserved for the channel owner; pick an agent name with --as`);
      const hadKey = local.includes(name);
      let id = yield* keys.identity(name, roomId);
      const info = { name, ...(opt.role ? { role: opt.role } : {}), ...(opt.about ? { about: opt.about } : {}), ...(auto ? { auto: true } : {}), ...(runs ? { runs } : {}) };

      // Agents join from a computer its person linked with `kiwi setup`; the computer vouches for them.
      const signIn = yield* signInOn(relay);

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
      const settle = (access: ChannelAccess, how: "approved" | "resumed" | "admitted") =>
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
          settleIn(alias, name);
          // Say what this agent runs on, so work that needs it finds it. Never worth failing a join over.
          if (canPost(scopes)) yield* Effect.ignoreCause(s.refreshCard(detectCard()));
          process.stderr.write(`${how === "resumed" ? "back in" : "joined"} "${alias}" as ${name} (key ${fingerprint(id.pk)})\n`);
          if (how === "resumed") out("this key is already a member: resumed, nothing new was granted.");
          if (how === "admitted") out("let in by this computer, which its person linked and seated here: no code to compare.");
          if (signIn) out(`Your human can watch everything you do here at ${relay}/#${encodeURIComponent(code)}`);
          const { state } = yield* s.state();
          const seat = state.members.get(name);
          out(joinedText(alias, name, { scopes, hold: holdLine(state), charter: charterLines(state), mode: modeLine(state, name), human: humanOf(state, name), role: seat?.role, about: seat?.about }));
        });

      const machine = loadMachine();
      const linked = machine?.linked && machine.relay === relay ? machine : null;
      const seatedHere = machine && machine.relay === relay ? machine : null;
      // The same key, already a member (the config was lost, or this is a re-run): resume. Only keys the
      // owner signed come back that way; one with no key for now goes on to this computer's seat below.
      if (hadKey) {
        const access = yield* Channel.fx.resume(relay, code, id).pipe(Effect.catchIf((err) => err instanceof RelayError && [401, 403, 404].includes(err.status), () => Effect.succeed(null)));
        const local = Object.values((yield* keys.config).channels).find((c) => c.roomId === roomId);
        if (access && (access.keys[String(access.epoch)] ?? local?.keys[String(access.epoch)])) return yield* settle(access, "resumed");
      }
      // This computer's own seat in the channel lets it in at once, with no request and no code.
      if (seatedHere) {
        const admitted = yield* admitHere(code, relay, seatedHere, id, name, opt.about);
        if (admitted) {
          if (admitted.name !== name) {
            // Someone holds that name: this agent is in under the next free one, and its key moves with it.
            if (!auto) out(`"${name}" is taken here; you're in as ${admitted.name}.`);
            yield* renameKey(admitted.name);
          }
          return yield* settle(admitted.access, "admitted");
        }
      }
      if (signIn && !linked) {
        return yield* die(
          "this computer isn't set up for Kiwi yet. Its person runs this once, in a terminal:\n" +
            "  kiwi setup\n" +
            "Then run this join again.",
        );
      }
      const vouch = () => (linked ? Effect.promise(() => vouchFor(linked, roomId, id.pk)) : Effect.succeed(null));
      // This computer, offered to the owner: approving this agent can seat it, so its later agents come in on their own.
      const asking = () =>
        Effect.promise(async () => {
          const computer = seatedHere ? await computerOffer(seatedHere, roomId, id.pk) : null;
          return computer ? { ...info, seatOffer: computer } : info;
        });
      // Asking again with the same key resumes the same request, so re-running this is always safe.
      // A key that was removed or declined can never come back; ask again with a fresh one.
      const req = yield* Channel.fx.requestJoin(relay, code, id, yield* asking(), null, yield* vouch()).pipe(
        Effect.catchIf(outForGood, () =>
          Effect.gen(function* () {
            yield* keys.forgetIdentity(name, roomId);
            id = yield* keys.identity(name, roomId);
            return yield* Channel.fx.requestJoin(relay, code, id, yield* asking(), null, yield* vouch());
          }),
        ),
      );
      out(`asked to join as ${name}.`);
      if (linked) out(`Vouched for by this computer${linked.linked?.name ? `, linked to ${linked.linked.name}` : ""}.`);
      if ((yield* admitLocally(code, relay, id, req.requestId, { ...(auto ? {} : { name }), role: opt.role, about: opt.about }))) {
        out("The channel's owner key is on this computer, so it let you in itself (no code to compare).");
      } else out(`waiting for the owner to open your request…`);
      const deadline = Date.now() + parseDuration(opt.timeout ?? "30m") * 1000;
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
          return yield* die("the owner denied this request");
        }
        if (st.status === "approved") return yield* settle(st.access, "approved");
        if (Date.now() > deadline) {
          return yield* die(
            shown
              ? `still waiting for approval (code ${shown}); run the same command again to keep waiting (same request, same code)`
              : "the owner hasn't opened your request yet; run the same command again to keep waiting (same request)",
            3,
          );
        }
        yield* Effect.sleep(1500);
      }
    }),

  hook: () => runHook(args[1] ?? ""),

  /**
   * Set up this computer, once, by its person: what Kiwi keeps and where, linking the computer to
   * their account (so agents started here join already vouched for as theirs), and whether Kiwi
   * may keep Claude Code agents reachable.
   */
  setup: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const relay = relayUrl();
      const sub = args[1];
      const linkStatus = (m: Parameters<typeof machineFx.status>[0]) => machineFx.status(m).pipe(Effect.catchCause(() => Effect.succeed(null)));
      if (sub === "unlink") {
        const m = loadMachine() ?? (yield* die("this computer isn't linked"));
        yield* Effect.ignoreCause(machineFx.unlink(m));
        forgetMachine();
        return out("This computer is unlinked. Agents started here now need their person to vouch for them from a link.");
      }
      if (sub === "status") {
        const m = loadMachine();
        if (!m?.linked) return out("This computer isn't linked to an account. Run kiwi setup.");
        const st = yield* linkStatus(m);
        if (st?.status !== "linked") return out("This computer's link was removed. Run kiwi setup again.");
        out(`Linked to ${st.name ?? m.linked.name ?? "your account"} (${m.label}).`);
        // What the link page showed, and what its agents' join requests are compared against.
        return out(`Its code: ${yield* Effect.promise(() => machineCode(m.identity.pk))}`);
      }

      out("Setting up Kiwi on this computer.\n");
      out(`1. What Kiwi keeps: everything lives in ${home()}, readable only by you. That's your agents' keys and the`);
      out("   channels they're in. Nothing else on this computer is touched.\n");

      let m = loadMachine();
      const current = m?.linked && m.relay === relay ? yield* linkStatus(m) : null;
      if (m && current?.status === "linked") {
        const linked = m;
        out(`2. This computer is already linked to ${current.name ?? m.linked?.name ?? "your account"} (code ${yield* Effect.promise(() => machineCode(linked.identity.pk))}).`);
        out(`   ${SEAT_HOW}\n`);
      } else {
        if (!m || m.relay !== relay || m.linked) m = yield* Effect.promise(() => newMachine(relay));
        const mine = m;
        saveMachine(mine);
        yield* machineFx.register(mine);
        const url = linkUrl(mine);
        out("2. Link this computer to your account, so agents you start here join as yours.");
        out(`   Open this page, sign in, and check it shows ${yield* Effect.promise(() => machineCode(mine.identity.pk))}:`);
        out(`   ${url}`);
        openBrowser(url);
        out("   Waiting for you to confirm in the browser…");
        const deadline = Date.now() + 15 * 60_000;
        for (;;) {
          const st = yield* linkStatus(mine);
          if (st?.status === "linked") {
            mine.linked = { name: st.name, at: Date.now() };
            saveMachine(mine);
            out(`   Linked to ${st.name ?? "your account"}. ${SEAT_HOW}\n`);
            break;
          }
          if (st?.status === "expired" || Date.now() > deadline) return yield* die("the link expired before it was confirmed; run kiwi setup again");
          yield* Effect.sleep(2000);
        }
      }

      if (existsSync(join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")))) {
        if (hooksInstalled()) {
          out("3. Claude Code: Kiwi keeps your agents reachable there (3 hooks). kiwi hooks uninstall removes them.\n");
        } else {
          out("3. Claude Code: Kiwi can keep agents reachable by adding 3 hooks to its settings. They only act in folders");
          out("   where an agent joined a channel: they remind it to listen and hand it messages it missed.");
          const yes = yield* confirm("   Add them?");
          yield* keys.update((c) => {
            c.claudeHooks = yes ? "on" : "off";
          });
          if (yes) installHooks();
          out(yes ? "   Added.\n" : "   Skipped. kiwi hooks install adds them any time.\n");
        }
      }

      if (!Bun.which("kiwi")) out(`To type plain kiwi, add this line to your shell profile:\n  export PATH="${join(homedir(), ".kiwi", "bin")}:$PATH"\n`);
      out("Done. To bring an agent into a channel, give it the channel's join command (in Details, on the web).");
    }),

  hooks: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const sub = args[1] ?? "status";
      const raw = args[2];
      const usage = "usage: kiwi hooks install|uninstall|status [claude|codex|gemini|cursor|grok]";
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

  requests: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const reqs = yield* s.requests();
      if (!reqs.length) return out("no pending join requests");
      for (const r of reqs) {
        const who = r.kind === "human" ? `person, signed in as ${r.sponsoredBy?.name ?? "?"}` : r.sponsoredBy ? `agent of ${r.sponsoredBy.name}` : "agent";
        const code = r.code ?? (r.check === "waiting" ? "waiting" : "unchecked");
        // A name someone here already holds comes as the next free one: asked for X, it joins as X-2.
        const asked = r.askedAs && r.askedAs !== r.name ? ` (asked as ${r.askedAs}, which is taken)` : "";
        // What it says runs it, which approving signs into its seat; an agent that said nothing is worth a second look.
        const runs = r.kind === "human" ? "" : r.runs ? ` · runs ${runsLine(r.runs)}` : " · says nothing about what runs it";
        out(`${code.padEnd(8)} ${r.name}${asked}${r.role ? ` (${r.role})` : ""} · ${who}${r.computer ? ` on ${r.computer.label}` : ""}${runs} · key ${fingerprint(r.pk)} · ${ago(r.ts)}`);
      }
      if (reqs.some((r) => r.computer)) out("kiwi approve CODE --seat also lets that computer's later agents into this channel on their own");
      if (reqs.some((r) => r.check === "waiting")) out("waiting: the requester shows its code in a moment; run kiwi requests again");
      if (reqs.some((r) => r.check === "unchecked")) out(`unchecked: ${TOO_MANY_REQUESTS}`);
    }),

  check: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const owner = yield* s.adminCh("check join requests");
      const key = (args[1] ?? (yield* die("usage: kiwi check KEY (the request's key, from kiwi requests)"))).trim();
      const r = (yield* s.requests()).find((x) => x.check === "unchecked" && fingerprint(x.pk).startsWith(key));
      if (!r) return yield* die(`no unchecked request with key ${key} (see: kiwi requests)`);
      const what = `${r.name} (key ${fingerprint(r.pk)})`;
      if (!(yield* confirm(`Start the code check for ${what}?`))) return yield* die("checking needs your human's go-ahead; re-run with --yes once they confirm");
      yield* owner.fx.checkRequest(r);
      out(`checking ${what}: the requester shows its 6-digit code in a moment (kiwi requests)`);
    }),

  approve: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const r = yield* findRequest(s, args[1] ?? (yield* die("usage: kiwi approve CODE [--name NEWNAME] [--role ROLE] [--scopes member|read-only] [--seat] [--yes]")));
      if (opt.seat && !r.computer) return yield* die(`${r.name} didn't come from a computer that can be seated here; approve without --seat`);
      const scopes = opt.scopes === undefined ? undefined : (parseScopes(opt.scopes) ?? (yield* die(`"${opt.scopes}" isn't a level: say member or read-only`)));
      const name = opt.name ?? r.name;
      if (!NAME_RE.test(name) || name === OWNER_NAME) return yield* new BadName(`"${name}" isn't an allowed name; approve with --name NAME`);
      const taken = (yield* s.members(true)).find((m) => m.name === name && m.active);
      if (taken) return yield* new BadName(`"${name}" is already a member; approve under another name with --name`);
      // Asking to be the coordinator doesn't make you one: the owner says --role coordinator themselves.
      const askedCoordinator = r.role?.trim().toLowerCase() === COORDINATOR && opt.role?.trim().toLowerCase() !== COORDINATOR;
      const role = opt.role ?? (askedCoordinator ? undefined : r.role);
      const may = scopes ? `, to ${mayDo(scopes)}` : "";
      const seat = opt.seat && r.computer ? `, and let agents from ${r.computer.label} in from now on` : "";
      if (!(yield* confirm(`Let "${name}"${role ? ` (${role})` : ""} in${may}${seat}? Verification code ${r.code}`))) {
        return yield* die(`approving needs your human's go-ahead: once they confirm the joining agent shows ${r.code}, re-run with --yes`);
      }
      const admitted = yield* (yield* s.adminCh("let anyone in")).fx.approve(r, { name, role, about: r.about, ...(scopes ? { scopes } : {}) }, { seat: !!opt.seat });
      out(`approved ${admitted.name} (${r.code})${scopes ? `; they may ${describeScopes(scopes)}` : ""}${seat ? `; agents from ${r.computer!.label} now come in on their own` : ""}${askedCoordinator ? `; it asked to be the coordinator, which takes: kiwi approve ${r.code} --role coordinator` : ""}`);
      // Coordinator mode with nobody coordinating yet: the first agent in takes it.
      const coordinator = yield* s.ensureCoordinator().pipe(Effect.catchCause(() => Effect.succeed(null)));
      if (coordinator) out(`${coordinator} is the coordinator: people talk with them (kiwi role ${coordinator} none to change that)`);
    }),

  deny: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const r = yield* findRequest(s, args[1] ?? (yield* die("usage: kiwi deny CODE|KEY")), { byKey: true });
      yield* (yield* s.adminCh("turn a request down")).fx.deny(r.id);
      out(`denied ${r.name} (${r.code ?? `key ${fingerprint(r.pk)}`})`);
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

  /** The channel's rooms: listed for anyone. */
  rooms: () =>
    Effect.gen(function* () {
      const s = yield* session();
      out(formatRooms((yield* s.state()).state));
    }),

  /** Owner: make or rename a room. */
  room: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [sub, a, b] = args.slice(1);
      if (sub === "create") {
        const name = a ?? (yield* die("usage: kiwi room create NAME"));
        const { id, state } = yield* s.createRoom(name);
        return out(`made #${state.rooms.get(id)?.name ?? name} (id ${id}); send there with --room ${state.rooms.get(id)?.name ?? id}`);
      }
      if (sub === "rename") {
        const room = a ?? (yield* die("usage: kiwi room rename NAME|ID NEWNAME"));
        yield* s.renameRoom(room, b ?? (yield* die("usage: kiwi room rename NAME|ID NEWNAME")));
        return out(`renamed #${room} to #${b}`);
      }
      return yield* die("usage: kiwi room create NAME | kiwi room rename NAME|ID NEWNAME (owner); kiwi rooms lists them");
    }),

  /** What each member may do besides read: listed for anyone, set by the owner. */
  scope: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [name, given] = args.slice(1);
      const { state } = yield* s.state();
      if (!name) {
        for (const m of [...state.members.values()].filter((x) => x.active).sort((a, b) => a.name.localeCompare(b.name))) {
          out(`${m.name}${m.name === s.me ? " (you)" : ""}: ${m.owner ? "everything (owner)" : mayDo(m.scopes)}`);
        }
        return;
      }
      yield* s.adminCh("set what members may do");
      const scopes =
        parseScopes(given ?? (yield* die("usage: kiwi scope NAME member|read-only [--yes]"))) ?? (yield* die(`"${given}" isn't a level: say member or read-only`));
      if (!(yield* confirm(`Let ${name} ${mayDo(scopes)}?`))) return yield* die("changing what a member may do needs your human's go-ahead; re-run with --yes");
      yield* s.setScopes(name, scopes);
      out(`${name} may now ${mayDo(scopes)}`);
    }),

  kick: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const owner = yield* s.adminCh("remove members");
      const name = args[1] ?? (yield* die("usage: kiwi kick NAME"));
      const m = (yield* s.members(true)).find((x) => x.name === name && x.active) ?? (yield* die(`"${name}" isn't a member`));
      if (m.owner) return yield* die("the owner can't be removed; `kiwi close` deletes the channel");
      const { state } = yield* s.state();
      yield* owner.fx.remove(m.pk);
      out(`removed ${name}; rotated the channel key so they can't read anything new`);
      // The coordinator gone: the next agent in coordinates (with none, delivery is as usual until one arrives).
      if (state.coordinator === name && state.mode.coordinatorOnly) {
        const next = yield* s.ensureCoordinator().pipe(Effect.catchCause(() => Effect.succeed(null)));
        out(next ? `${next} is the coordinator now` : "nobody coordinates now: make one with kiwi role NAME coordinator (meanwhile people talk with everyone)");
      }
    }),

  leave: () =>
    Effect.gen(function* () {
      const s = yield* session();
      if (s.identity.pk === s.cfg.ownerPk) return yield* die("you own this channel; `kiwi close` deletes it for everyone");
      yield* s.ch.fx.leave();
      yield* (yield* Keystore).forgetMember(s.alias, s.me);
      out(`${s.me} left "${s.alias}"; its key is gone from this machine`);
    }),

  close: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const owner = yield* s.adminCh("close the channel");
      if (!(yield* confirm(`Delete "${s.alias}" for everyone? Messages, members and keys are destroyed.`))) {
        return yield* die("closing needs your human's go-ahead; re-run with --yes once they confirm");
      }
      yield* owner.fx.close();
      yield* (yield* Keystore).wipeChannel(s.alias);
      out(`closed "${s.alias}": deleted at the relay and on this machine`);
    }),

  channels: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const cfg = yield* keys.config;
      const here = bindingFor(process.cwd());
      for (const [alias, c] of Object.entries(cfg.channels)) {
        const agents = (yield* keys.identitiesIn(c.roomId)).filter((n) => n !== c.owner && n !== c.person);
        const you = c.person ? `  you: ${c.person} (kiwi tui)` : "";
        out(`${here?.alias === alias ? "*" : " "} ${alias}${c.title && c.title !== alias ? ` (${c.title})` : ""}  ${agents.length ? `agents here: ${agents.join(", ")}` : "no agent keys"}${you}  ${c.relay}`);
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

  status: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [{ messages, state }, online] = yield* Effect.all([s.state(), s.who()], { concurrency: "unbounded" });
      const on = new Map([...online].map(([n, p]) => [n, { client: p.client, role: p.role }]));
      const snap = { alias: s.alias, me: s.me, state, online: on, unread: yield* s.unreadCount(state, messages) };
      out(opt.json ? JSON.stringify(statusJson(snap)) : formatStatus(snap));
    }),

  who: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [online, { state }] = yield* Effect.all([s.who(), s.state()], { concurrency: "unbounded" });
      if (!online.size) return out("nobody else is listening right now");
      for (const [name, p] of online) {
        const role = p.role ?? state.members.get(name)?.role;
        out(`${name}${role ? ` — ${role}` : ""} · ${p.client}`);
      }
    }),

  /**
   * One verb for everything said: --escalate hands it to a person (escalate), --ask makes it a
   * question (ask; with --re, in that thread), else a plain message. --re N puts it in #N's thread,
   * to the same recipients as ever (the `reply` alias is the one that answers #N's sender).
   */
  send: () =>
    Effect.gen(function* () {
      if (opt.escalate) {
        // It goes to your human and the owner, as it is: nothing else to choose.
        const extra = (["to", "image", "kind", "room", "ask", "wait"] as const).filter((f) => opt[f] !== undefined);
        if (extra.length) return yield* die(`--escalate goes to your human and the owner as it is; leave out ${extra.map((f) => `--${f}`).join(", ")}`);
        return yield* commands.escalate!();
      }
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
    }),

  /** `kiwi ask`: a question, the same as send --ask (in the task you're doing, unless you say where). */
  ask: () => {
    opt.ask = true;
    if (opt.kind === undefined) opt.kind = "ask";
    return commands.send!();
  },

  reply: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die('usage: kiwi reply N "text"'));
      const body = yield* text(2);
      if (!body.trim()) return yield* die("empty reply");
      const imgs = yield* images;
      out(`sent #${yield* s.reply(seq, body, (opt.kind ?? "msg") as Kind, imgs)}`);
    }),

  save: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi save N [dir]"));
      const { messages, state } = yield* s.state();
      const m = messages.find((x) => x.seq === seq && !ignored(state.trust.get(x.seq))) ?? (yield* die(`no message #${seq}`));
      if (!m.imgs?.length) return yield* die(`message #${seq} has no images`);
      for (const path of saveImages(seq, m.imgs, args[2] ?? ".")) out(path);
    }),

  show: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi show N [dir]"));
      const { messages, state } = yield* s.state();
      // Forged messages, and ones the owner doesn't allow, are left out everywhere (status counts them).
      const m = messages.find((x) => x.seq === seq && !ignored(state.trust.get(x.seq))) ?? (yield* die(`no message #${seq}`));
      // Images land under the channel's own folder (closing it deletes them), or where asked.
      const saved = m.imgs?.length ? saveImages(seq, m.imgs, args[2] ?? joinPath(home(), "downloads", s.ch.roomId)) : [];
      out(formatShown(m, messages, state, saved, s.me));
      // The rest of its thread, when there's more of it than #N, what it answers and its replies.
      const root = state.threadOf.get(seq) ?? seq;
      const near = new Set([seq, ...(m.re ?? []), ...messages.filter((x) => x.re?.includes(seq)).map((x) => x.seq)]);
      const rest = messages.filter((x) => state.threadOf.get(x.seq) === root && !near.has(x.seq) && !ignored(state.trust.get(x.seq)));
      if (rest.length) {
        out(`the rest of thread #${root}:`);
        for (const x of rest) out(`  ${render(x, state)}`);
      }
    }),

  log: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const { messages, state } = yield* s.state();
      const room = opt.room === undefined ? undefined : yield* s.roomId(opt.room, state);
      const shown = (opt.all ? messages : messages.filter((m) => m.kind !== "event" || m.ev?.op !== "hello")).filter(
        (m) => !ignored(state.trust.get(m.seq)) && (room === undefined || (m.kind !== "event" && state.roomOf.get(m.seq) === room)),
      );
      for (const m of shown.slice(-Number(opt.n ?? 30))) out(render(m, state));
    }),

  sh: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const script = (yield* text(1)) || (yield* die("usage: kiwi sh 'SCRIPT' (start with: kiwi sh 'cat README')"));
      const views = yield* sessionViews(s, script);
      const r = yield* Effect.promise(() => runSh(channelFiles(views), script));
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
      const [member, pick] = b === undefined ? [s.me, a] : [a, b];
      const color = pick === "none" ? null : isColor(pick) ? pick : yield* die(`"${pick}" isn't a colour: ${COLORS.join(", ")} (or none)`);
      yield* s.setColor(member, color);
      out(color ? `${member}'s colour is ${color}` : `cleared ${member}'s colour`);
    }),

  mode: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [which, onOff] = args.slice(1);
      if (!which) {
        const { state } = yield* s.state();
        return out(modeLine(state, s.me) ?? "mode: normal (kiwi mode coordinator-only on, as the owner, to route people through the coordinator)");
      }
      if (which !== "coordinator-only" || (onOff !== "on" && onOff !== "off")) return yield* die("usage: kiwi mode [coordinator-only on|off] [--no-strict]");
      const state = yield* s.setMode(onOff === "on", !opt["no-strict"]);
      out(modeLine(state, s.me) ?? "mode: normal");
    }),

  charter: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const given = args.slice(1).join(" ").trim();
      if (!given && !opt.clear) {
        const { state } = yield* s.state();
        return out(state.charter ? state.charter.text : "no charter (the owner sets one: kiwi charter \"what this channel is for, and its limits\")");
      }
      yield* s.adminCh("set the charter");
      if (!(yield* confirm(opt.clear ? "Clear the charter?" : `Set the charter to: ${given}?`))) return yield* die("changing the charter needs your human's go-ahead; re-run with --yes");
      const state = yield* s.setCharter(opt.clear ? null : given);
      out(state.charter ? `charter: ${state.charter.text}` : "cleared the charter");
    }),

  /** Owner: stop every agent at once, or let them carry on. */
  hold: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const off = args[1] === "off";
      if (args.length < 2) return out(holdLine((yield* s.state()).state) ?? "not on hold");
      yield* s.adminCh("put the channel on hold or lift it");
      const state = yield* s.setHold(!off, off ? undefined : args.slice(1).join(" ") || opt.note);
      out(holdLine(state) ?? "hold lifted: agents may carry on");
    }),

  /** Hand a decision to people instead of acting on it. */
  escalate: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const body = yield* text(1);
      if (!body.trim()) return yield* die('usage: kiwi escalate [--re N] "why this needs a person"');
      const re = opt.re === undefined ? undefined : Number(opt.re.replace(/^#/, "")) || (yield* die("--re takes a message number"));
      const { seq, to } = yield* s.escalate(body, re);
      out(`escalated #${seq} to ${to.join(" and ")}; wait for their answer before acting on it`);
    }),

  icon: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const emoji = args[1];
      const file = (yield* images)?.[0];
      if (!emoji && !file && !opt.clear) {
        const icon = yield* s.ch.fx.icon();
        if (!icon) return out("no icon (the owner sets one with: kiwi icon 🦊)");
        if (icon.kind === "emoji") return out(icon.emoji);
        const dir = joinPath(home(), "downloads", s.ch.roomId);
        mkdirSync(dir, { recursive: true });
        const path = joinPath(dir, `icon.${icon.mime.split("/")[1]}`);
        writeFileSync(path, Buffer.from(icon.data, "base64"));
        return out(`an image (${icon.mime}), saved at ${path}`);
      }
      const owner = yield* s.adminCh("set the channel's icon");
      const icon = opt.clear ? null : file ? { kind: "image" as const, mime: file.mime as "image/png", data: file.data } : { kind: "emoji" as const, emoji: emoji! };
      yield* owner.fx.setIcon(icon);
      out(icon === null ? "cleared the channel's icon" : icon.kind === "emoji" ? `the channel's icon is ${icon.emoji}` : "the channel's icon is that image");
    }),

  thread: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const seq = Number((args[1] ?? "").replace(/^#/, "")) || (yield* die("usage: kiwi thread N"));
      const { messages, state } = yield* s.state();
      if (!messages.some((m) => m.seq === seq)) return yield* die(`no message #${seq}`);
      const root = state.threadOf.get(seq) ?? seq;
      for (const m of messages) if (state.threadOf.get(m.seq) === root && !ignored(state.trust.get(m.seq))) out(render(m, state));
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
    }),

  tail: () =>
    Effect.gen(function* () {
      const s = yield* session();
      // Say what this agent runs on, so work that needs it finds it; never in the way of listening.
      yield* Effect.forkDetach(Effect.ignoreCause(s.refreshCard(detectCard())));
      yield* s.listen((m, state) => Effect.sync(() => out(render(m, state))), {
        client: "tail",
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
        client: "wait",
        ...(yield* delivery(s)),
        onStatus: (msg) => Effect.sync(() => void process.stderr.write(`kiwi: ${msg}\n`)),
        onNotice: (text) => Effect.andThen(Effect.sync(() => out(`* ${text}`)), woke),
      });
      const timeout = opt.timeout ? Effect.sleep(parseDuration(opt.timeout) * 1000) : Effect.never;
      yield* Effect.raceFirst(listening, Effect.raceFirst(Deferred.await(enough), timeout)).pipe(Effect.scoped);
      if (got) return;
      out(`no messages yet. Next: run this command again:\n  ${mcFor(s.alias, s.me)} ${args[0] === "listen" ? "listen --once" : "wait"} --timeout 10m`);
      return 2;
    }),

  watch: () =>
    Effect.gen(function* () {
      const url = opt.webhook ?? (yield* die("usage: kiwi watch --webhook URL [--for-me|--all]"));
      if (!/^https?:\/\//.test(url)) return yield* die("--webhook must be an http(s) URL");
      const secret = opt.secret ?? process.env.MC_WEBHOOK_SECRET;
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
          try {
            const res = await fetch(url, { method: "POST", headers, body });
            if (!res.ok) process.stderr.write(`kiwi: webhook ${res.status} for #${m.seq}\n`);
            return res.ok;
          } catch (err) {
            process.stderr.write(`kiwi: webhook failed for #${m.seq}: ${err instanceof Error ? err.message : err}\n`);
            return false;
          }
        });
      yield* s.listen(post, {
        client: "watch",
        // A webhook stands in for a person watching (a phone, CI): all chat unless narrowed.
        ...(yield* delivery(s)),
        ...(!opt["for-me"] && opt.thread === undefined ? { chat: true } : {}),
        onStatus: (msg) => Effect.sync(() => void process.stderr.write(`kiwi: ${msg}\n`)),
        onNotice: (text) =>
          Effect.sync(() => void fetch(url, { method: "POST", headers, body: JSON.stringify({ channel: s.alias, kind: "notice", text, ts: Date.now() }) }).catch(() => {})),
      });
    }),

  task: () =>
    Effect.gen(function* () {
      const s = yield* session();
      // kiwi task alone: the board.
      if (!args[1]) return yield* commands.tasks!();
      const sub = args[1];
      const STATE_FOR: Record<string, TaskState> = { start: "doing", review: "review", done: "done" };
      if (sub === "add") {
        const title = yield* text(2);
        if (!title.trim()) return yield* die('usage: kiwi task add "title" [--owner NAME] [--review NAME|any]');
        // Gone, and said so rather than refused, so an agent running older instructions still adds its task.
        for (const gone of ["after", "needs"] as const) if (opt[gone] !== undefined) process.stderr.write(`kiwi: --${gone} is gone (tasks don't wait on or match anything now); put it in the title or --detail\n`);
        const { state: before } = yield* s.state();
        const id = yield* s.taskAdd(title, { owner: opt.owner, detail: opt.detail, ...(opt.review !== undefined ? { review: opt.review } : {}) });
        const like = similarOpenTasks(before, title).map((t) => t.id);
        const lines = [`added ${taskId(id)}`];
        if (like.length) lines.push(looksLikeLine(like));
        return out(lines.join("\n"));
      }
      if (sub === "list") return yield* commands.tasks!();
      const id = yield* taskArg();
      if (sub === "show") {
        const { state } = yield* s.state();
        return out(formatTask(state, state.tasks.get(id) ?? (yield* die(`no task ${taskId(id)}`))));
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
      const note = args.slice(3).join(" ") || opt.note || undefined;
      let state: ChannelState;
      if (sub === "claim") state = yield* s.taskClaim(id);
      else if (sub === "review") state = yield* s.taskUpdate(id, { state: "review", note, ...(opt.review !== undefined ? { review: opt.review } : {}) });
      else if (sub === "approve") state = yield* s.taskUpdate(id, { state: "done", note });
      else if (sub === "reject") state = yield* s.taskUpdate(id, { state: "doing", note: note ?? (yield* die('usage: kiwi task reject T7 "what needs to change"')) });
      else if (sub in STATE_FOR) state = yield* s.taskUpdate(id, { state: STATE_FOR[sub], note });
      // Blocked (an older name) is a note on work in progress; cancelling finishes it, marked cancelled.
      else if (sub === "block") state = yield* s.taskUpdate(id, { note: `blocked${note ? `: ${note}` : ""}` });
      else if (sub === "cancel") state = yield* s.taskUpdate(id, { state: "cancelled", note });
      else if (sub === "drop") state = yield* s.taskUpdate(id, { owner: null, note });
      else if (sub === "note") state = yield* s.taskUpdate(id, { note: note ?? (yield* die('usage: kiwi task note T7 "…"')) });
      else return yield* die(`unknown task command "${sub}"`);
      const t = state.tasks.get(id)!;
      out(`${taskId(id)} ${taskStateWord(t)}${t.owner ? ` @${t.owner}` : ""}: ${t.title}`);
    }),

  tasks: () =>
    Effect.gen(function* () {
      if (opt.global) {
        const keys = yield* Keystore;
        const cfg = yield* keys.config;
        const aliases = Object.keys(cfg.channels).sort();
        if (!aliases.length) return yield* die("no channels yet (see: kiwi create, kiwi join)");
        // Only channels the acting agent is in itself: another local agent's keys are not ours to use.
        const me = opt.as ?? process.env.KIWI_AS ?? bindingFor(process.cwd())?.as ?? (yield* die("--global needs to know who you are: pass --as NAME, or run it from your bound folder"));
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
      // Roles aren't asked for: the owner sets them (kiwi role NAME ROLE, or People on the web).
      if (opt.role || opt.about) return yield* die("the owner sets roles and rules: ask them in a message (kiwi send --to human \"…\")");
      yield* s.hello();
      const me = (yield* s.state()).state.members.get(s.me);
      out(`announced ${s.me}${me?.role ? ` as ${me.role}` : ""}`);
    }),

  /** Roles are the owner's to give: kiwi role NAME ROLE sets one (kiwi status shows everyone's). */
  role: () =>
    Effect.gen(function* () {
      const s = yield* session();
      const [member, role] = args.slice(1);
      if (!member || !role) return yield* die('usage: kiwi role NAME ROLE [--about "rules"] [--yes] (the owner sets roles; "none" clears one)');
      yield* s.adminCh("set roles");
      const clear = role.toLowerCase() === "none";
      if (!(yield* confirm(clear ? `Clear ${member}'s role?` : `Make ${member} ${role}?`))) return yield* die("changing a role needs your human's go-ahead; re-run with --yes");
      const { state } = yield* s.state();
      const wasCoordinator = state.coordinator === member;
      const becomes = !clear && role.trim().toLowerCase() === COORDINATOR;
      // Coordinator-only follows the role. Taking it away turns the mode off first, so there's never a moment
      // of coordinator mode with nobody in it (when an owner page would hand the role to the next agent).
      if (wasCoordinator && !becomes && state.mode.coordinatorOnly) {
        yield* s.setMode(false);
        out("coordinator-only is off: nobody holds the coordinator role now");
      }
      yield* s.decideRole(member, { role: clear ? null : role, ...(opt.about !== undefined ? { about: opt.about } : {}) });
      out(clear ? `cleared ${member}'s role` : `made ${member} ${role}`);
      if (becomes && !state.mode.coordinatorOnly) {
        yield* s.setMode(true);
        out("coordinator-only is on: people talk with the coordinator");
      }
    }),

  web: () =>
    Effect.gen(function* () {
      const alias = yield* channelAlias();
      const c = (yield* config).channels[alias]!;
      // A link that carries a person's key (the owner's, or a seat brought here for kiwi tui) never goes
      // into an agent's transcript: printed only for a person at a terminal of their own.
      const personKey = (name: string) => name === c.owner || name === c.person;
      const refuse = () => die("this link carries a person's key: run kiwi web in a terminal of your own, outside Claude Code (not with !)");
      if (c.owner && !opt["sign-in"]) {
        if (inAgentHarness()) return yield* refuse();
        out(yield* ownerLink(c));
        process.stderr.write("kiwi: this link carries the owner key (approve, remove, close); keep it private\n");
        return;
      }
      let link = `${c.relay}/#${encodeURIComponent(c.code)}`;
      if (opt["sign-in"]) {
        // Hand this agent's identity to the browser, so the page acts as that member.
        const name = yield* agentName(c);
        if (personKey(name) && inAgentHarness()) return yield* refuse();
        const id = yield* (yield* Keystore).identity(name, c.roomId);
        link += `&id=${b64url(new TextEncoder().encode(JSON.stringify(id)))}`;
      }
      out(link);
      if (opt["sign-in"]) process.stderr.write("kiwi: this link carries your identity; keep it private\n");
      else process.stderr.write("kiwi: opening it asks to join; the owner approves the browser like any agent\n");
    }),

  prompt: () =>
    Effect.gen(function* () {
      const alias = yield* channelAlias();
      const cfg = (yield* config).channels[alias];
      const name = yield* agentName(cfg);
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

  /** The person's seat in a terminal: the owner key here, or one brought from the web with --link. */
  tui: () =>
    Effect.gen(function* () {
      const keys = yield* Keystore;
      const tty = process.stdin.isTTY && process.stdout.isTTY;
      const link = opt.link ?? (args[1]?.includes("#") ? args[1] : undefined);
      // kiwi tui <join code>: pair this terminal by a code you approve on the web.
      const pairing = !link && args[1]?.startsWith("mc2-") ? args[1].trim() : undefined;
      if (pairing) {
        try {
          decodeJoinCode(pairing);
        } catch {
          return yield* die("that isn't a join code (they look like mc2-…-…)");
        }
      }
      if (!tty && !pairing) return yield* die("kiwi tui needs a terminal (stdin and stdout a TTY)");
      if (pairing && !opt.pair) return yield* die("copy the whole command from your browser: the channel's menu → Use in a terminal… (it ends with --pair …)");
      const alias = link ? yield* importPerson(link) : pairing ? yield* pairSeat(pairing, opt.pair!) : yield* personAlias();
      // Paired from something that isn't a terminal: the seat is here now, for the next kiwi tui.
      if (!tty) return out(`Your seat is on this computer now. Open it in a terminal with: kiwi tui${Object.keys((yield* keys.config).channels).length > 1 ? ` -c ${alias}` : ""}`);
      const c = (yield* keys.config).channels[alias]!;
      const name = opt.as ?? c.person ?? c.owner;
      const here = yield* keys.identitiesIn(c.roomId);
      if (!name || (name !== c.person && name !== c.owner)) {
        return yield* die(
          `there's no person's seat for "${alias}" on this computer (agents here: ${here.join(", ") || "none"}).\n` +
            "  On the web, open the channel's menu → Use in a terminal, and run the command it shows (kiwi tui mc2-…).",
        );
      }
      if (!here.includes(name)) return yield* die(`the key for ${name} in "${alias}" is gone from this computer; bring it again with kiwi tui mc2-… (the channel's menu → Use in a terminal)`);
      acting.alias = alias;
      acting.name = name;
      const s = yield* openPersonSession(alias, c, name);
      const { runTui } = yield* Effect.promise(() => import("../tui/app.ts"));
      yield* Effect.promise(() => runTui(s, { label: `${name}${s.ownerCh ? " (owner)" : ""}` }));
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

/** How messages reach this agent, in one line: its harness's hooks when they can, else the one command to keep running. */
function listenLine(mc: string): string {
  if (hooksListen()) return "Messages for you arrive on their own: Kiwi's hooks wake you when one comes. Don't run listen.";
  const h = here().harness;
  if (h === "claude") return `Start a Monitor on \`${COMMANDS.listen(mc)}\` with the longest timeout allowed, and start it again whenever it ends: that's how messages reach you.`;
  if (h && extraInstalled(h)) return "Kiwi's hooks hand you new messages as your turns start and end. Don't run listen.";
  return `Run \`${COMMANDS.listenOnce(mc)}\`, and run it again every time it returns: it returns when messages for you arrive.`;
}

/** What an agent reads when it gets in (brief.ts): who it is, who directs it, how messages reach it, and where the rest is. */
export function joinedText(
  alias: string,
  agent: string,
  as: { scopes?: readonly Scope[]; hold?: string | null; charter?: string | null; mode?: string | null; human?: string | null; role?: string; about?: string } = {},
): string {
  const mc = mcFor(alias, agent);
  return briefText({ alias, agent, mc, listen: listenLine(mc), ...as });
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
      return stop(`${err.message}; forgot it on this machine`, 4);
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
  // One runtime for the whole command: the relay over HTTP, and this computer's files.
  const runtime = ManagedRuntime.make(AgentLive);
  const exit = await runtime.runPromiseExit(command ? command() : die(`unknown command "${cmd}" (see: kiwi help)`));
  if (Exit.isFailure(exit)) await runtime.runPromise(fail(exit.cause));
  else if (cmd !== "mcp" && cmd !== "relay") process.exit(exit.value ?? 0);
}
