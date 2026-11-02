// Seats: which agent a command or hook acts for, with no -c/--as to type.
//
// A seat is one agent's place in one channel, kept per working directory: `kiwi join`
// writes it, and every later command and hook from that directory finds it. Several
// agents can work from one checkout, so a seat also remembers the harness that joined
// (claude, codex…) and, when the harness says, its session and process:
//
//   - a session finds the seat it joined with;
//   - a restarted agent (new session, same checkout, same harness) takes its old seat
//     back, once the session that held it is gone;
//   - a second live agent in the same checkout never acts as the first;
//   - a session that listens as an agent from here is that agent, even when a later join
//     replaced its seat (the listener records which session started it);
//   - a seat an agent joined from a plain terminal is never taken over by a session.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { geminiAncestor, kimiAncestor, kimiCodePid, mimoHere, piHere, zcodePid, type ProcessTree } from "./ancestry.ts";
import { loadConfig, updateConfig, type Config, type SeatRecord } from "./config.ts";
import { holdsSeat, isSeatHarness, seatHeldAway, seatHolds, seatRefusal } from "./hold.ts";
import { pidAlive } from "./pid.ts";
import { readLaunch } from "@kiwi/core/membership.ts";
import { omit } from "@kiwi/core/omit.ts";
import type { SeatPlace } from "./terminals/plugin.ts";
import { locate } from "./terminals/registry.ts";

type Harness = NonNullable<SeatRecord["harness"]>;

/** The agent running this process: its harness, and the session and process when the harness says. */
export interface Here {
  harness?: Harness;
  session?: string;
  /** The harness's own process (Claude Code's CLAUDE_PID): the seat is held while it lives. */
  pid?: number;
  model?: string;
}

export type Binding = SeatRecord;

/** A live process listening for an agent, and the session that started it when its harness says. */
export interface Listener {
  alias: string;
  as: string;
  harness?: Harness;
  session?: string;
  /** The harness's own process (Claude Code's CLAUDE_PID), not the listener's. */
  pid?: number;
  /** Where it was started. */
  cwd?: string;
}

/**
 * Who this process runs for, from the variables each harness sets on its shell
 * commands and hooks (see SESSION_ENV in hooks.ts for where each comes from).
 */
export function onGrokBot(env: Record<string, string | undefined> = process.env, host: string = hostname()): boolean {
  return env.KIWI_HARNESS?.trim().toLowerCase() === "grok-bot" || /^grok-bot-vm-/.test(host);
}

export function here(env: Record<string, string | undefined> = process.env, tree: ProcessTree = {}, host: string = hostname()): Here {
  const found = harnessHere(env, tree, host);
  const launch = found.session ? null : readLaunch(env.KIWI_LAUNCH);
  if (!launch) return found;
  const named = env.KIWI_HARNESS?.trim().toLowerCase();
  const harness = found.harness ?? (isSeatHarness(named) ? named : undefined);
  return { ...found, ...(harness ? { harness } : {}), session: `launch-${launch}` };
}

function harnessHere(env: Record<string, string | undefined>, tree: ProcessTree, host: string): Here {
  const pid = Number(env.CLAUDE_PID);
  const pi = piHere(env, tree);
  if (pi) return { harness: "pi", ...(env.KIWI_PI_SESSION ? { session: env.KIWI_PI_SESSION } : {}), ...(pi.pid ? { pid: pi.pid } : {}) };
  const mimo = mimoHere(env, tree);
  if (mimo && env.MIMOCODE_SESSION_ID) return { harness: "mimo", session: env.MIMOCODE_SESSION_ID, ...(mimo.pid ? { pid: mimo.pid } : {}) };
  if (mimo) return mimo.pid ? heldByProcess("mimo", mimo.pid) : { harness: "mimo" };
  const kimi = kimiCodePid(env, tree);
  if (kimi) return heldByProcess("kimi", kimi);
  const zcode = zcodePid(env, tree);
  if (zcode) return heldByProcess("zcode", zcode);
  // Grok Build can inherit CLAUDECODE from a Claude-compat session. GROK_SESSION_ID wins.
  if (env.GROK_SESSION_ID) return { harness: "grok", session: env.GROK_SESSION_ID };
  if (env.CLAUDECODE) return { harness: "claude", ...(env.CLAUDE_CODE_SESSION_ID ? { session: env.CLAUDE_CODE_SESSION_ID } : {}), ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}) };
  if (env.CODEX_THREAD_ID) return { harness: "codex", session: env.CODEX_THREAD_ID };
  if (env.GEMINI_CLI) return geminiHere(tree);
  if (onGrokBot(env, host)) return { harness: "grok-bot" };
  if (env.CURSOR_AGENT) return { harness: "cursor", ...(env.CURSOR_CONVERSATION_ID ? { session: env.CURSOR_CONVERSATION_ID } : {}) };
  if (env.OPENCODE_SESSION_ID) return { harness: "opencode", session: env.OPENCODE_SESSION_ID };
  return {};
}

export type NamedHookHarness = "codex" | "gemini" | "grok";

export function hereAs(harness: string | undefined, env: Record<string, string | undefined> = process.env, tree: ProcessTree = {}, host: string = hostname()): Here {
  if (harness === "codex") return { harness: "codex", ...(env.CODEX_THREAD_ID ? { session: env.CODEX_THREAD_ID } : {}) };
  if (harness === "grok") return { harness: "grok", ...(env.GROK_SESSION_ID ? { session: env.GROK_SESSION_ID } : {}) };
  if (harness === "gemini") return geminiHere(tree);
  return here(env, tree, host);
}

function modelKey(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "");
}

function sameModel(seat: string | undefined, session: string | undefined): boolean {
  return !seat || !session || modelKey(seat) === modelKey(session);
}

function heldByProcess(harness: "kimi" | "mimo" | "zcode" | "gemini", pid: number): Here {
  return { harness, session: `${harness}-pid-${pid}`, pid };
}

function geminiHere(tree: ProcessTree): Here {
  const pid = geminiAncestor(tree);
  return pid ? heldByProcess("gemini", pid) : { harness: "gemini" };
}

export function kimiHookHere(tree: ProcessTree = {}): Here {
  const kimi = kimiAncestor(tree);
  return kimi ? heldByProcess("kimi", kimi) : {};
}

/** The name an agent gets when it doesn't pick one: what it runs in. */
export function baseName(h: Here): string {
  return h.harness ?? "agent";
}

/**
 * The owner-signed `runs` name for a seat harness. Seats store `claude` so
 * agents stay named `claude`; cards and `runs` store `claude-code`.
 */
export function canonicalHarness(h: string | undefined): string | undefined {
  if (!h) return undefined;
  const card: Record<string, string> = { claude: "claude-code", kimi: "kimi-code", mimo: "mimocode", grokbot: "grok-bot" };
  return card[h] ?? h;
}

/** Whether a seat harness and a card/`runs` harness are the same product. */
export function sameHarness(a: string | undefined, b: string | undefined): boolean {
  const left = canonicalHarness(a);
  const right = canonicalHarness(b);
  return !!left && left === right;
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Directories too broad to bind: the home folder and the filesystem root. A
 * binding there would make every session in every project act as that agent.
 */
export function tooBroad(dir: string): boolean {
  const d = real(dir);
  return d === real(homedir()) || dirname(d) === d;
}

function mainCheckout(dir: string): string | null {
  for (let d = resolve(dir); dirname(d) !== d; d = dirname(d)) {
    const dot = join(d, ".git");
    let folder: boolean;
    try {
      folder = statSync(dot).isDirectory();
    } catch {
      // No .git at this level: the checkout's top is further up.
      continue;
    }
    if (folder) return null;
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"))?.[1]?.trim();
    if (!gitdir) return null;
    const at = resolve(d, gitdir);
    try {
      const common = resolve(at, readFileSync(join(at, "commondir"), "utf8").trim());
      return basename(common) === ".git" ? dirname(common) : null;
    } catch {
      // A .git file without a commondir is a submodule's, not a worktree's: it has no main checkout to look in.
      return null;
    }
  }
  return null;
}

function seatedUp(cfg: Config, dir: string): boolean {
  for (let d = resolve(dir); !tooBroad(d); d = dirname(d)) if (seatsAt(cfg, d).some((b) => cfg.channels[b.alias])) return true;
  return false;
}

/** Where to look for `dir`'s seats: `dir` itself, or, when no seat is anywhere up from a git worktree, its main checkout. */
function seatHome(cfg: Config, dir: string): string {
  if (seatedUp(cfg, dir)) return dir;
  const main = mainCheckout(dir);
  if (!main) return dir;
  const bound = Object.keys(cfg.bindings ?? {}).find((d) => real(d) === real(main)) ?? main;
  return seatedUp(cfg, bound) ? bound : dir;
}

/** The seats kept for one directory. One seat is stored as a plain object, which clients before 0.10 read too. */
export function seatsAt(cfg: Config, dir: string): Binding[] {
  const v = cfg.bindings?.[dir];
  return (Array.isArray(v) ? v : v ? [v] : []).filter((b) => b && typeof b.alias === "string" && typeof b.as === "string");
}

function store(cfg: Config, dir: string, seats: Binding[]): void {
  const bindings = { ...(cfg.bindings ?? {}) };
  if (!seats.length) delete bindings[dir];
  else bindings[dir] = seats.length === 1 ? seats[0]! : seats;
  cfg.bindings = bindings;
}

/** How long a seat with no process to check stays its session's after that session last used it. */
const STALE_MS = 12 * 3600_000;
/** How often a session's use of its seat is written down (so `seen` is fresh enough for STALE_MS). */
const SEEN_EVERY_MS = 10 * 60_000;

/**
 * Whether a session other than `who` still holds this seat. A seat records its harness's process
 * when the harness says (Claude Code), and then it's held while that process runs. Otherwise
 * (Codex, Grok…) it's held while that session listens or has used it in the last 12 hours.
 */
function heldElsewhere(b: Binding, who: Here, listening: (alias: string, as: string) => boolean, now = Date.now()): boolean {
  if (!b.session || b.session === who.session) return false;
  if (b.pid) return b.pid !== who.pid && pidAlive(b.pid);
  return listening(b.alias, b.as) || now - (b.seen ?? b.at ?? 0) < STALE_MS;
}

/**
 * Remember that an agent working in `dir` is `b.as` on channel `b.alias`, alongside any other
 * agents working there. Returns false for home/root.
 */
export function bindDirectory(dir: string, b: Binding, listening: (alias: string, as: string) => boolean = () => false, opened?: number): boolean {
  if (tooBroad(dir)) return false;
  const at = resolve(dir);
  let bound = true;
  updateConfig((cfg) => {
    bound = !seatHeldAway(cfg, b.alias, b.as) && (opened === undefined || seatRefusal(cfg, b.alias, b.as, opened) === null);
    if (!bound) return;
    // Without a session nothing could tell two seats apart later, so a sessionless seat replaces the others like it (the last join wins, as before seats),
    // except one whose agent is listening right now: that's another agent at work here, not an older seat of this one.
    const others = seatsAt(cfg, at).filter(
      (s) => !(s.alias === b.alias && s.as === b.as) && (!!s.hold || !(b.harness && !b.session && !s.session && s.harness === b.harness && !listening(s.alias, s.as))),
    );
    const holds = seatHolds(cfg, b.alias, b.as);
    store(cfg, at, [...others, { ...b, ...(holds ? { holds } : {}), at: Date.now() }]);
  });
  return bound;
}

export interface SeatOptions {
  who?: Here;
  /** Only seats in this channel (by alias). */
  alias?: string;
  /** The live listeners on this machine (hooks.ts): who listens as which agent, and from which session. */
  listeners?: () => Listener[];
  /** Record this session on the seat it takes (default true). */
  claim?: boolean;
}

export function seatsFor(from: string, opts: SeatOptions = {}): Binding[] {
  const dir = seatHome(loadConfig(), from);
  const who = opts.who ?? here();
  const live = opts.listeners?.() ?? [];
  const listening = (alias: string, as: string) => live.some((l) => l.alias === alias && l.as === as);
  // A listener this very session started (its session, or its harness's process).
  const ours = (l: Listener) => (!!who.session && l.session === who.session) || (!!who.pid && l.pid === who.pid);
  const cfg = loadConfig();
  // Every seat from here up, whoever holds it.
  const above: Binding[] = [];
  for (let d = resolve(dir); !tooBroad(d); d = dirname(d)) above.push(...seatsAt(cfg, d).filter((b) => cfg.channels[b.alias]));
  const everywhere = Object.keys(cfg.bindings ?? {}).flatMap((d) => seatsAt(cfg, d));
  // A listener says who this session is only when it has no seat of its own anywhere up the tree (in any
  // channel), and that agent's seat is missing or was a session's: listening as someone never makes you them.
  const heardOk = (l: Listener) =>
    !above.some((b) => !!who.session && b.session === who.session) &&
    // That agent's seat, if it has one here, must be one a session could hold: not joined from a plain terminal,
    // not without a session (whose agent may just not be listening right now), not held by another live session.
    !seatHeldAway(cfg, l.alias, l.as) &&
    !everywhere.some((b) => b.alias === l.alias && b.as === l.as && !!b.session && heldElsewhere(b, who, listening)) &&
    !above.some((b) => b.alias === l.alias && b.as === l.as && (b.plain || !b.session || heldElsewhere(b, who, listening))) &&
    !live.some((o) => o.alias === l.alias && o.as === l.as && !ours(o));
  for (let d = resolve(dir); !tooBroad(d); d = dirname(d)) {
    const atDir = seatsAt(cfg, d).filter((b) => cfg.channels[b.alias] && (!opts.alias || b.alias === opts.alias));
    const loop = atDir.filter((b) => holdsSeat(b));
    if (loop.length) return loop;
    const seats = atDir.filter((b) => !seatHeldAway(cfg, b.alias, b.as));
    const mine = who.session ? seats.filter((b) => b.session === who.session) : [];
    if (mine.length) {
      // Note that this session still uses it, so nobody takes it for stale (seats with no process to check).
      if (opts.claim !== false) keepSeen(d, mine);
      return mine;
    }
    // This session listens as an agent from here: that's who it is, even when its seat was lost (a later join
    // from a plain terminal replaced it). It gets its seat back, beside the others.
    // Recorded where the listener runs, never deeper (the first level up from here that holds its folder).
    const heard = live.find((l) => ours(l) && !!l.cwd && within(l.cwd, d) && cfg.channels[l.alias] && (!opts.alias || l.alias === opts.alias) && heardOk(l));
    if (heard) {
      const seat: Binding = {
        alias: heard.alias,
        as: heard.as,
        ...(who.harness ? { harness: who.harness } : {}),
        ...(who.session ? { session: who.session } : {}),
        ...(who.pid ? { pid: who.pid } : {}),
        at: Date.now(),
        seen: Date.now(),
      };
      let held = false;
      if (opts.claim !== false)
        updateConfig((c) => {
          held = seatHeldAway(c, seat.alias, seat.as);
          const holds = seatHolds(c, seat.alias, seat.as);
          if (!held) store(c, d, [...seatsAt(c, d).filter((b) => !(b.alias === seat.alias && b.as === seat.as)), { ...seat, ...(holds ? { holds } : {}) }]);
        });
      return held ? [] : [seat];
    }
    if (!seats.length) continue;
    // A plain terminal in a folder with one agent acts as that agent, as before seats.
    if (!who.session && !who.harness && seats.length === 1) return [seats[0]!];
    // Seats this agent could be: no other live session holds them, nobody else is listening as them, the harness fits
    // (or one side doesn't say), and a session never takes over a seat joined from a plain terminal.
    const listenedElsewhere = (b: Binding) => live.some((l) => l.alias === b.alias && l.as === b.as && !ours(l));
    const free = seats.filter(
      // (Only a session asks whether someone else listens: a plain terminal can't tell its own listener from another's.)
      (b) =>
        !heldElsewhere(b, who, listening) &&
        !(who.session && !b.session && listenedElsewhere(b)) &&
        !(b.plain && who.session) &&
        (!b.harness || !who.harness || b.harness === who.harness) &&
        sameModel(b.model, who.model),
    );
    // Several free seats: the one of this session's harness, when there's exactly one; otherwise it would be guessing.
    const ofMine = free.filter((b) => who.harness && b.harness === who.harness);
    const pick = free.length === 1 ? free[0]! : who.session && ofMine.length === 1 ? ofMine[0]! : null;
    if (!pick) return [];
    if (opts.claim !== false && who.session && (pick.session !== who.session || (who.pid && pick.pid !== who.pid))) {
      // The previous holder's process goes with it: this session's, or none.
      const rest = omit(pick, "pid", "model", "harnessSession", "loop");
      const taken: Binding = {
        ...rest,
        session: who.session,
        ...(who.pid ? { pid: who.pid } : {}),
        ...(who.model ? { model: who.model } : {}),
        ...(who.harness && !pick.harness ? { harness: who.harness } : {}),
        at: Date.now(),
        seen: Date.now(),
      };
      let held = false;
      updateConfig((c) => {
        held = seatHeldAway(c, pick.alias, pick.as);
        if (!held)
          store(
            c,
            d,
            seatsAt(c, d).map((b) => (b.alias === pick.alias && b.as === pick.as ? taken : b)),
          );
      });
      return held ? [] : [taken];
    }
    return [pick];
  }
  return [];
}

export function notePlace(seats: readonly Binding[], env: Record<string, string | undefined> = process.env): void {
  const place: SeatPlace = locate(env);
  if (!seats.length) return;
  const keys = new Set(seats.map((b) => `${b.alias}\u0000${b.as}`));
  const same = (b: Binding) => keys.has(`${b.alias}\u0000${b.as}`);
  const alike = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const held = (b: Binding): boolean => alike(b.term, place.term) && alike(b.rex, place.rex) && alike(b.tmux, place.tmux);
  if (seats.every(held)) return;
  updateConfig((c) => {
    for (const dir of Object.keys(c.bindings ?? {})) {
      const at = seatsAt(c, dir);
      if (!at.some(same)) continue;
      store(
        c,
        dir,
        at.map((b) => {
          if (!same(b)) return b;
          const rest = { ...b };
          delete rest.term;
          delete rest.rex;
          delete rest.tmux;
          return { ...rest, ...(place.term ? { term: place.term } : {}), ...(place.rex ? { rex: place.rex } : {}), ...(place.tmux ? { tmux: place.tmux } : {}) };
        }),
      );
    }
  });
}

export function noteHarnessSession(seats: readonly Binding[], id: string): void {
  const stale = seats.filter((s) => s.harnessSession !== id);
  if (!stale.length) return;
  const ours = (b: Binding) => stale.some((s) => sameSeat(s, b) && s.session === b.session);
  updateConfig((c) => {
    for (const dir of Object.keys(c.bindings ?? {})) {
      const seats = seatsAt(c, dir);
      if (seats.some(ours))
        store(
          c,
          dir,
          seats.map((b) => (ours(b) ? { ...b, harnessSession: id } : b)),
        );
    }
  });
}

export function bindingFor(dir: string, opts: SeatOptions = {}): Binding | null {
  const [only, ...more] = seatsFor(dir, opts);
  return only && !more.length ? only : null;
}

function keepSeen(dir: string, mine: Binding[]): void {
  const stale = mine.filter((m) => !m.pid && Date.now() - (m.seen ?? m.at ?? 0) > SEEN_EVERY_MS);
  if (!stale.length) return;
  updateConfig((c) =>
    store(
      c,
      dir,
      seatsAt(c, dir).map((b) => (stale.some((m) => sameSeat(b, m)) ? { ...b, seen: Date.now() } : b)),
    ),
  );
}

export function seatsHeldAnywhere(who: Here = here(), opts: Pick<SeatOptions, "claim"> = {}): Binding[] {
  if (!who.session) return [];
  const cfg = loadConfig();
  return Object.keys(cfg.bindings ?? {}).flatMap((d) => {
    const mine = seatsAt(cfg, d).filter((b) => b.session === who.session && cfg.channels[b.alias] && !seatHeldAway(cfg, b.alias, b.as));
    if (opts.claim !== false) keepSeen(d, mine);
    return mine;
  });
}

export function sameSeat(a: Binding, b: Binding): boolean {
  return a.alias === b.alias && a.as === b.as;
}

/** Whether `path` is `dir` or inside it. */
function within(path: string, dir: string): boolean {
  const p = real(path);
  const d = real(dir);
  return p === d || p.startsWith(d.endsWith("/") ? d : `${d}/`);
}

/** The seats in `dir` or its nearest ancestor that has any, whoever holds them. */
export function seatsNear(from: string): Binding[] {
  const cfg = loadConfig();
  for (let d = resolve(seatHome(cfg, from)); !tooBroad(d); d = dirname(d)) {
    const seats = seatsAt(cfg, d).filter((b) => cfg.channels[b.alias]);
    if (seats.length) return seats;
  }
  return [];
}
