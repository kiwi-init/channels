// Local state in ~/.kiwi (override with KIWI_HOME):
//   config.json            joined channels: room, pinned owner keys, channel keys by epoch
//   identities/<room>/<n>  each agent's keys for one channel, destroyed with it
//   cursors/<ch>/<agent>   last sequence number each agent has consumed
//   cache/<room>.jsonl     decrypted, verified messages (so state folds are fast)

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AnswerMemory, BlobMemory, RecordMemory } from "./client.ts";
import type { ChannelAccess } from "./crypto.ts";
import { generateIdentity, withExchangeKey, type Identity } from "./identity.ts";
import type { Member } from "./membership.ts";
import { BLOB_ID_RE, type Message } from "./protocol.ts";
import type { FoldBase } from "./state.ts";
import type { Signed, SigningBudget } from "./sas.ts";

/** Public relay used when neither --relay nor KIWI_RELAY is given. */
export const DEFAULT_RELAY = "https://channels.kiwiinit.com";

export interface ChannelConfig extends ChannelAccess {
  relay: string;
  /** The join code (it only lets others *ask* to join). */
  code: string;
  /** Default agent name for this channel on this machine. */
  as?: string;
  /** This machine holds the owner key (the human who approves joins). */
  owner?: string;
  /**
   * A person's own seat on this machine (their key, the owner's included).
   * Agent commands never pick it.
   */
  person?: string;
  /** The channel's name, as its owner set it (sealed: only members can read it). */
  title?: string;
}

/** One agent's seat in a working directory (seats.ts reads and writes these). */
export interface SeatRecord {
  alias: string;
  as: string;
  harness?: "claude" | "codex" | "gemini" | "cursor" | "grok" | "opencode" | "kimi" | "mimo";
  session?: string;
  pid?: number;
  /** When a session took this seat. */
  at?: number;
  /** When its session last used it (kept for seats with no process to check). */
  seen?: number;
  /** Joined from a process that named no harness (a plain terminal, an unknown tool): no session ever takes it over. */
  plain?: true;
  model?: string;
}

/** Drop the seats `drop` matches from every directory. */
export function dropSeats(cfg: Config, drop: (b: SeatRecord) => boolean): void {
  for (const [dir, v] of Object.entries(cfg.bindings ?? {})) {
    const kept = (Array.isArray(v) ? v : [v]).filter((b) => !drop(b));
    if (!kept.length) delete cfg.bindings![dir];
    else cfg.bindings![dir] = kept.length === 1 ? kept[0]! : kept;
  }
}

/** A join request this machine is waiting on. */
export interface PendingJoin {
  code: string;
  relay: string;
  as: string;
  alias: string;
  requestId: string;
}

export interface Config {
  default?: string;
  channels: Record<string, ChannelConfig>;
  pending?: Record<string, PendingJoin>;
  /**
   * Agents that asked to join without picking a name and are still waiting: "room dir harness session"
   * → the name they asked under, so running the same join again resumes the same request.
   */
  asking?: Record<string, { as: string; at: number }>;
  /**
   * Working directory → the agent (or agents) working there: what commands and hooks act for
   * without -c/--as (see seats.ts). One seat is a plain object, several an array.
   */
  bindings?: Record<string, SeatRecord | SeatRecord[]>;
  /** What this computer's person chose in `kiwi setup` about Claude Code hooks. */
  claudeHooks?: "on" | "off";
  harnessHooks?: Partial<Record<"codex" | "gemini" | "cursor" | "grok" | "kimi", "on" | "off">>;
  wakeOff?: string[];
}

export function home(): string {
  if (process.env.KIWI_HOME) {
    tightenHome(process.env.KIWI_HOME);
    return process.env.KIWI_HOME;
  }
  const dir = join(homedir(), ".kiwi");
  if (existsSync(dir)) {
    tightenHome(dir);
    return dir;
  }
  // Carry state over from the project's earlier names, once. An older client may still be
  // running against ~/.channel-one: don't pull its files out from under it; use it in place.
  for (const name of [".channel-one", ".modelchannel"]) {
    const old = join(homedir(), name);
    if (!existsSync(old)) continue;
    if (oldClientRunning(old)) {
      tightenHome(old);
      return old;
    }
    renameSync(old, dir);
    tightenHome(dir);
    return dir;
  }
  return dir;
}

/** Directories already considered this process. home() is on the hot path; one look is enough. */
const tightened = new Set<string>();

/** Top-level names kiwi itself creates. Nothing else is walked. `bin` is not here, so it stays 0755. */
const KIWI_DIRS = ["cache", "cursors", "downloads", "hook-state", "identities", "listeners", "records"] as const;
const KIWI_FILES = ["config.json", "machine.json"] as const;

function isRealDir(p: string): boolean {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isRealFile(p: string): boolean {
  try {
    return lstatSync(p).isFile();
  } catch {
    return false;
  }
}

/** True when `dir` already holds kiwi state. KIWI_HOME is user-supplied: do not chmod a tree that is not ours. */
export function hasKiwiState(dir: string): boolean {
  return isRealFile(join(dir, "config.json")) || isRealFile(join(dir, "machine.json")) || isRealDir(join(dir, "identities"));
}

/**
 * Make an existing kiwi home private, once. The root is chmodded only when it
 * already holds kiwi state (`config.json`, `machine.json`, or `identities/`).
 * Only kiwi's own entries are walked, never the rest of the tree: KIWI_HOME is
 * user-supplied, and pointing it at a home directory or a project must not
 * chmod that tree. Symlinks are not followed.
 */
function tightenHome(dir: string): void {
  if (tightened.has(dir)) return;
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  tightened.add(dir);
  if (!hasKiwiState(dir)) return;
  try {
    chmodSync(dir, 0o700);
    for (const name of KIWI_DIRS) lockKiwiDir(join(dir, name), name === "downloads");
    for (const name of KIWI_FILES) {
      const p = join(dir, name);
      if (!isRealFile(p)) continue;
      try {
        chmodSync(p, 0o600);
      } catch {}
    }
  } catch {
    // A file this user can't chmod must not stop startup.
  }
}

/** chmod one kiwi directory and what is inside it. Files become 0600 only under downloads. */
function lockKiwiDir(dir: string, privateFiles: boolean): void {
  if (!isRealDir(dir)) return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    return;
  }
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let child;
    try {
      child = lstatSync(p);
    } catch {
      continue;
    }
    if (child.isSymbolicLink()) continue;
    if (child.isDirectory()) {
      lockKiwiDir(p, privateFiles);
      continue;
    }
    if (child.isFile() && privateFiles) {
      try {
        chmodSync(p, 0o600);
      } catch {}
    }
  }
}

/** Whether a live process is still listening out of an old state directory. */
function oldClientRunning(dir: string): boolean {
  const listeners = join(dir, "listeners");
  if (!existsSync(listeners)) return false;
  return readdirSync(listeners).some((f) => {
    const pid = Number(f.split(".").pop());
    try {
      return pid > 0 && (process.kill(pid, 0), true);
    } catch {
      return false;
    }
  });
}

/** The join checks this computer signed as a channel's owner, per channel (see sas.ts). */
export const signingBudget: SigningBudget = {
  load(roomId) {
    try {
      const t = JSON.parse(readFileSync(join(home(), "checks", `${safe(roomId)}.json`), "utf8")) as unknown;
      return Array.isArray(t) ? (t as Signed[]) : [];
    } catch {
      return [];
    }
  },
  save(roomId, signed) {
    writePrivate(join(home(), "checks", `${safe(roomId)}.json`), JSON.stringify(signed));
  },
};

export function writePrivate(path: string, data: string | Uint8Array): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  // Exclusive create. The first name is predictable, so a symlink planted there
  // must fail the open instead of being followed. Leave it in place and use a
  // fresh name; unlinking it would reopen the race.
  const names = [`${path}.${process.pid}.tmp`, `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`];
  let blocked: unknown;
  for (const tmp of names) {
    try {
      writeFileSync(tmp, data, { mode: 0o600, flag: "wx" });
    } catch (err) {
      if (fileExists(err)) {
        blocked = err;
        continue;
      }
      throw err;
    }
    try {
      renameSync(tmp, path);
    } catch (err) {
      try {
        rmSync(tmp, { force: true });
      } catch {}
      throw err;
    }
    try {
      chmodSync(path, 0o600);
    } catch {}
    return;
  }
  throw blocked;
}

function fileExists(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "EEXIST";
}

export function loadConfig(): Config {
  const path = join(home(), "config.json");
  if (!existsSync(path)) return { channels: {} };
  return JSON.parse(readFileSync(path, "utf8")) as Config;
}

export function saveConfig(cfg: Config): void {
  writePrivate(join(home(), "config.json"), JSON.stringify(cfg, null, 2) + "\n");
}

/**
 * Change the config safely while other mc processes (other agents on this
 * machine, their hooks and listeners) do the same: take a lock, read the
 * latest version, apply the change, write it back. A plain load-then-save
 * would silently undo whatever another agent wrote in between.
 */
export function updateConfig(change: (cfg: Config) => void): Config {
  mkdirSync(home(), { recursive: true, mode: 0o700 });
  return withLock(join(home(), "config.lock"), () => {
    const cfg = loadConfig();
    change(cfg);
    saveConfig(cfg);
    return cfg;
  });
}

/** Run `fn` while holding a lock directory, so concurrent kiwi processes take turns. */
function withLock<T>(lock: string, fn: () => T): T {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // A lock left behind by a crashed process expires after a few seconds.
      try {
        const age = Date.now() - statSync(lock).mtimeMs;
        if (age > 5_000) rmSync(lock, { recursive: true, force: true });
      } catch {}
      if (Date.now() > deadline) throw new Error(`couldn't lock ${lock}; if no kiwi is running, delete it`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * A name as a file name, reversibly: anything but lowercase letters, digits, _ . and - is
 * spelled out (~hex~), so "Win" and "win", or "josé" and "jos_", never share a file, even on
 * case-insensitive disks.
 */
function safe(s: string): string {
  const out = [...s].map((c) => (/[a-z0-9_.-]/.test(c) ? c : `~${c.codePointAt(0)!.toString(16)}~`)).join("");
  // "." and ".." are path segments, not names. Spell them out, the way segment() does.
  if (out === ".") return "~2e~";
  if (out === "..") return "~2e~~2e~";
  return out;
}

/** Each channel's cursors live in a folder of their own, so forgetting one never touches another's. */
function cursorDir(channel: string): string {
  return join(home(), "cursors", safe(channel));
}

function cursorPath(channel: string, agent: string): string {
  return join(cursorDir(channel), safe(agent));
}

export function readCursor(channel: string, agent: string): number | null {
  const path = cursorPath(channel, agent);
  return existsSync(path) ? Number(readFileSync(path, "utf8").trim()) || 0 : null;
}

export function writeCursor(channel: string, agent: string, seq: number): void {
  writePrivate(cursorPath(channel, agent), `${seq}\n`);
}

/** Sequence numbers already delivered out of band (e.g. by `ask --wait`), so tail/wait skip them. */
function seenPath(channel: string, agent: string): string {
  return `${cursorPath(channel, agent)}.seen`;
}

export function readSeen(channel: string, agent: string): Set<number> {
  const path = seenPath(channel, agent);
  if (!existsSync(path)) return new Set();
  return new Set(readFileSync(path, "utf8").split(/\s+/).filter(Boolean).map(Number));
}

export function markSeen(channel: string, agent: string, seqs: number[]): void {
  if (!seqs.length) return;
  const cursor = readCursor(channel, agent) ?? 0;
  const all = [...readSeen(channel, agent), ...seqs].filter((s) => s > cursor);
  writePrivate(seenPath(channel, agent), [...new Set(all)].sort((a, b) => a - b).join("\n") + "\n");
}

/**
 * An agent's keys for one channel. Keys are never shared between channels, so
 * wiping a channel (close, leave, removal) destroys the only keys that could
 * open its wrapped channel keys: any copy of the relay's data, backups
 * included, becomes permanently unreadable.
 */
export async function loadIdentity(name: string, roomId: string): Promise<Identity> {
  const path = join(identityDir(roomId), `${safe(name)}.json`);
  // Keys from before identities were per channel move into the channel that used them.
  const legacy = join(home(), "identities", `${safe(name)}.json`);
  if (!existsSync(path) && existsSync(legacy)) {
    writePrivate(path, readFileSync(legacy, "utf8"));
    rmSync(legacy, { force: true });
  }
  if (existsSync(path)) {
    const stored = JSON.parse(readFileSync(path, "utf8")) as Identity;
    const id = await withExchangeKey(stored);
    if (id !== stored) writePrivate(path, JSON.stringify(id, null, 2) + "\n");
    return id;
  }
  const id = await generateIdentity(name);
  writePrivate(path, JSON.stringify(id, null, 2) + "\n");
  return id;
}

/** Keep a key brought from elsewhere (a person's). Never replaces one this machine has. */
export function saveIdentity(id: Identity, roomId: string): void {
  const path = join(identityDir(roomId), `${safe(id.name)}.json`);
  if (existsSync(path)) throw new Error(`this computer already has a key named ${id.name} in this channel`);
  writePrivate(path, JSON.stringify(id, null, 2) + "\n");
}

function identityDir(roomId: string): string {
  return join(home(), "identities", safe(roomId));
}

/** Agent names this machine holds keys for in a channel (the owner's key included). */
/** Throw away one agent's key for a channel (say, after it was removed), so the next join makes a fresh one. */
export function forgetIdentity(name: string, roomId: string): void {
  rmSync(join(identityDir(roomId), `${safe(name)}.json`), { force: true });
}

export function identitiesIn(roomId: string): string[] {
  const dir = identityDir(roomId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return (JSON.parse(readFileSync(join(dir, f), "utf8")) as Identity).name;
      } catch {
        return null;
      }
    })
    .filter((n): n is string => !!n);
}

/** Destroy this machine's keys for a channel it never got into (denied, abandoned). */
export function forgetIdentities(roomId: string): void {
  rmSync(identityDir(roomId), { recursive: true, force: true });
}

/** Persist a channel's access after keys change (rotation). */
export function saveAccess(alias: string, access: ChannelAccess): void {
  updateConfig((cfg) => {
    const c = cfg.channels[alias];
    if (c) cfg.channels[alias] = { ...c, epoch: access.epoch, keys: { ...c.keys, ...access.keys }, ...(access.signedTitle ? { signedTitle: true } : {}) };
  });
}

/**
 * Forget a whole channel on this machine: config, every local agent's keys,
 * message cache, cursors and downloads. Only for a channel that is gone for
 * everyone (its owner closed it, or this machine's owner closed it).
 */
export function wipeChannel(alias: string): void {
  let c: ChannelConfig | undefined;
  updateConfig((cfg) => {
    c = cfg.channels[alias];
    delete cfg.channels[alias];
    if (cfg.default === alias) delete cfg.default;
    dropSeats(cfg, (b) => b.alias === alias);
  });
  if (c) {
    rmSync(identityDir(c.roomId), { recursive: true, force: true });
    for (const suffix of ["", ".seq", ".base"]) rmSync(cachePath(c.roomId) + suffix, { force: true });
    rmSync(join(home(), "downloads", c.roomId), { recursive: true, force: true });
    rmSync(join(home(), "answers", safe(c.roomId)), { recursive: true, force: true });
    rmSync(blobDir(c.roomId), { recursive: true, force: true });
  }
  rmSync(cursorDir(alias), { recursive: true, force: true });
}

/**
 * Forget one agent's membership: it left or was removed. Other agents on this
 * machine in the same channel keep theirs; the channel itself is forgotten
 * only once no local agent is left in it.
 */
export function forgetMember(alias: string, name: string): void {
  const c = loadConfig().channels[alias];
  if (!c) return;
  forgetIdentity(name, c.roomId);
  rmSync(cursorPath(alias, name), { force: true });
  rmSync(seenPath(alias, name), { force: true });
  const left = identitiesIn(c.roomId).filter((n) => n !== c.owner && n !== c.person);
  // The owner key stays as long as the channel exists: without it, nobody can ever close it.
  const ownerHere = !!c.owner && identitiesIn(c.roomId).includes(c.owner);
  const personHere = !!c.person && identitiesIn(c.roomId).includes(c.person);
  if (!left.length && !ownerHere && !personHere) return wipeChannel(alias);
  updateConfig((cfg) => {
    dropSeats(cfg, (b) => b.alias === alias && b.as === name);
    const ch = cfg.channels[alias];
    if (ch?.person === name) delete ch.person;
    if (ch?.as === name) ch.as = left[0] ?? ch.owner;
  });
}

/**
 * The newest owner-signed member record this machine has seen, per key: a relay serving an older,
 * broader one (from before the owner narrowed what that member may do) doesn't win.
 */
export const fileRecordMemory = {
  get(room: string, pk: string): Member | null {
    try {
      return (JSON.parse(readFileSync(join(home(), "records", `${safe(room)}.json`), "utf8")) as Record<string, Member>)[pk] ?? null;
    } catch {
      return null;
    }
  },
  set(room: string, pk: string, m: Member): void {
    const path = join(home(), "records", `${safe(room)}.json`);
    mkdirSync(join(home(), "records"), { recursive: true, mode: 0o700 });
    withLock(`${path}.lock`, () => {
      let all: Record<string, Member> = {};
      try {
        all = JSON.parse(readFileSync(path, "utf8")) as Record<string, Member>;
      } catch {
        // First record for this room, or a torn file: start over (the relay serves them all again).
      }
      all[pk] = m;
      writePrivate(path, JSON.stringify(all));
    });
  },
};

export const fileAnswerMemory: AnswerMemory = {
  get(room, what) {
    try {
      const kept = JSON.parse(readFileSync(join(home(), "answers", safe(room), `${what}.json`), "utf8")) as { etag?: unknown; data?: unknown };
      return typeof kept.etag === "string" && kept.data && typeof kept.data === "object" ? { etag: kept.etag, data: kept.data } : null;
    } catch {
      return null;
    }
  },
  set(room, what, answer) {
    writePrivate(join(home(), "answers", safe(room), `${what}.json`), JSON.stringify(answer));
  },
};

const blobDir = (room: string) => join(home(), "cache", `${safe(room)}.blobs`);

export const BLOB_CACHE_BYTES = 128 * 1024 ** 2;

function trimBlobs(dir: string, most: number): void {
  const files = readdirSync(dir)
    .filter((f) => BLOB_ID_RE.test(f))
    .flatMap((f) => {
      try {
        const s = statSync(join(dir, f));
        return [{ path: join(dir, f), size: s.size, used: s.mtimeMs }];
      } catch {
        return [];
      }
    });
  let total = files.reduce((n, f) => n + f.size, 0);
  if (total <= most) return;
  files.sort((a, b) => a.used - b.used);
  for (const f of files) {
    if (total <= most) return;
    rmSync(f.path, { force: true });
    total -= f.size;
  }
}

export function fileBlobs(most = BLOB_CACHE_BYTES): BlobMemory {
  return {
    get(room, id) {
      if (!BLOB_ID_RE.test(id)) return null;
      const path = join(blobDir(room), id);
      try {
        const blob = new Uint8Array(readFileSync(path));
        const now = new Date();
        utimesSync(path, now, now);
        return blob;
      } catch {
        return null;
      }
    },
    set(room, id, blob) {
      if (!BLOB_ID_RE.test(id)) return;
      try {
        writePrivate(join(blobDir(room), id), blob);
        trimBlobs(blobDir(room), most);
      } catch {}
    },
    drop(room, id) {
      if (!BLOB_ID_RE.test(id)) return;
      rmSync(join(blobDir(room), id), { force: true });
    },
  };
}

const fileBlobMemory = fileBlobs();

function cachePath(roomId: string): string {
  return join(home(), "cache", `${roomId}.jsonl`);
}

/**
 * Cached messages for a room, oldest first. Every listener on this machine shares the file, so
 * older versions could write a message more than once: if that happened, the file is rewritten
 * once without the copies.
 */
export function readCache(roomId: string): Message[] {
  const path = cachePath(roomId);
  if (!existsSync(path)) return [];
  const bySeq = new Map<number, Message>();
  let lines = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    lines++;
    try {
      const m = JSON.parse(line) as Message;
      bySeq.set(m.seq, m);
    } catch {
      // A torn final line from a crash mid-write; the next sync refetches it.
    }
  }
  const messages = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  if (lines > messages.length) {
    withLock(`${path}.lock`, () => {
      writePrivate(path, messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length ? "\n" : ""));
      writePrivate(`${path}.seq`, String(messages.at(-1)?.seq ?? 0));
    });
  }
  return messages;
}

/** Add messages to a room's cache, skipping any another listener on this machine already wrote. */
export function appendCache(roomId: string, messages: Message[]): void {
  if (!messages.length) return;
  const path = cachePath(roomId);
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  withLock(`${path}.lock`, () => {
    // The highest seq written so far; messages arrive in order, so anything at or below it is a copy.
    const last = existsSync(`${path}.seq`) ? Number(readFileSync(`${path}.seq`, "utf8")) || 0 : 0;
    const fresh = messages.filter((m) => m.seq > last);
    if (!fresh.length) return;
    appendFileSync(path, fresh.map((m) => JSON.stringify(m)).join("\n") + "\n", { mode: 0o600 });
    writePrivate(`${path}.seq`, String(fresh.at(-1)!.seq));
  });
}

function readBase(roomId: string): FoldBase | null {
  try {
    return JSON.parse(readFileSync(`${cachePath(roomId)}.base`, "utf8")) as FoldBase;
  } catch {
    return null;
  }
}

function dropBase(roomId: string): void {
  rmSync(`${cachePath(roomId)}.base`, { force: true });
}

function keepBase(roomId: string, base: FoldBase): void {
  const path = cachePath(roomId);
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  withLock(`${path}.lock`, () => {
    if ((readBase(roomId)?.n ?? 0) >= base.n) return;
    writePrivate(`${path}.base`, JSON.stringify(base));
  });
}

// ---------- the same files, as services ----------
//
// The agent session and the commands reach ~/.kiwi through these, so a test (or
// any other store) can stand in for the disk. The live ones are the functions
// above, unchanged: the same files, the same locks, the same layout.

/** The config, the identities and what's kept per channel: config.json, identities/, records/, checks/. */
export interface KeystoreApi {
  readonly config: Effect.Effect<Config>;
  /** Change the config under its lock (see updateConfig). */
  readonly update: (change: (cfg: Config) => void) => Effect.Effect<Config>;
  /** An agent's key for a channel, made the first time it's asked for. */
  readonly identity: (name: string, roomId: string) => Effect.Effect<Identity>;
  readonly identitiesIn: (roomId: string) => Effect.Effect<string[]>;
  readonly forgetIdentity: (name: string, roomId: string) => Effect.Effect<void>;
  /** Keep a key brought from elsewhere (a person's); never replaces one this machine has. */
  readonly saveIdentity: (id: Identity, roomId: string) => Effect.Effect<void>;
  readonly forgetIdentities: (roomId: string) => Effect.Effect<void>;
  /** Persist a channel's keys after they change (a rotation). */
  readonly saveAccess: (alias: string, access: ChannelAccess) => Effect.Effect<void>;
  /** One agent left or was removed: forget what it held (and the channel, once nobody here is left). */
  readonly forgetMember: (alias: string, name: string) => Effect.Effect<void>;
  /** The channel is gone for everyone: forget all of it. */
  readonly wipeChannel: (alias: string) => Effect.Effect<void>;
  /** The join checks this computer signed as an owner. */
  readonly budget: SigningBudget;
  /** The newest member record seen per key. */
  readonly records: RecordMemory;
  readonly answers?: AnswerMemory;
  readonly blobs: BlobMemory;
}

export class Keystore extends Context.Service<Keystore, KeystoreApi>()("kiwi/Keystore") {}

/** The decrypted, verified messages kept per room (cache/<room>.jsonl). */
export class Cache extends Context.Service<
  Cache,
  {
    readonly read: (roomId: string) => Effect.Effect<Message[]>;
    readonly append: (roomId: string, messages: Message[]) => Effect.Effect<void>;
    readonly base: (roomId: string) => Effect.Effect<FoldBase | null>;
    readonly keepBase: (roomId: string, base: FoldBase) => Effect.Effect<void>;
    readonly dropBase: (roomId: string) => Effect.Effect<void>;
  }
>()("kiwi/Cache") {}

/** How far each agent has read, and what reached it out of band (cursors/<ch>/<agent>, .seen). */
export class Cursor extends Context.Service<
  Cursor,
  {
    readonly read: (channel: string, agent: string) => Effect.Effect<number | null>;
    readonly write: (channel: string, agent: string, seq: number) => Effect.Effect<void>;
    readonly seen: (channel: string, agent: string) => Effect.Effect<Set<number>>;
    readonly markSeen: (channel: string, agent: string, seqs: number[]) => Effect.Effect<void>;
  }
>()("kiwi/Cursor") {}

/** ~/.kiwi (or KIWI_HOME, read at each call, as everything above does). */
export const fileKeystore: KeystoreApi = {
  config: Effect.sync(loadConfig),
  update: (change) => Effect.sync(() => updateConfig(change)),
  identity: (name, roomId) => Effect.promise(() => loadIdentity(name, roomId)),
  identitiesIn: (roomId) => Effect.sync(() => identitiesIn(roomId)),
  forgetIdentity: (name, roomId) => Effect.sync(() => forgetIdentity(name, roomId)),
  saveIdentity: (id, roomId) => Effect.sync(() => saveIdentity(id, roomId)),
  forgetIdentities: (roomId) => Effect.sync(() => forgetIdentities(roomId)),
  saveAccess: (alias, access) => Effect.sync(() => saveAccess(alias, access)),
  forgetMember: (alias, name) => Effect.sync(() => forgetMember(alias, name)),
  wipeChannel: (alias) => Effect.sync(() => wipeChannel(alias)),
  budget: signingBudget,
  records: fileRecordMemory,
  answers: fileAnswerMemory,
  blobs: fileBlobMemory,
};

/** The three, on this computer's disk. */
export const LocalFiles: Layer.Layer<Keystore | Cache | Cursor> = Layer.mergeAll(
  Layer.succeed(Keystore, fileKeystore),
  Layer.succeed(Cache, {
    read: (roomId) => Effect.sync(() => readCache(roomId)),
    append: (roomId, messages) => Effect.sync(() => appendCache(roomId, messages)),
    base: (roomId) => Effect.sync(() => readBase(roomId)),
    keepBase: (roomId, base) => Effect.sync(() => keepBase(roomId, base)),
    dropBase: (roomId) => Effect.sync(() => dropBase(roomId)),
  }),
  Layer.succeed(Cursor, {
    read: (channel, agent) => Effect.sync(() => readCursor(channel, agent)),
    write: (channel, agent, seq) => Effect.sync(() => writeCursor(channel, agent, seq)),
    seen: (channel, agent) => Effect.sync(() => readSeen(channel, agent)),
    markSeen: (channel, agent, seqs) => Effect.sync(() => markSeen(channel, agent, seqs)),
  }),
);
