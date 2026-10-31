// Wire protocol shared by the relay, the CLI, the MCP server and the web app.
//
// The relay only ever sees opaque envelopes: a sequence number, a timestamp,
// and AES-GCM ciphertext. Everything meaningful (sender, recipients, body,
// coordination events, signatures) lives inside the encrypted payload.

import { DEVICE_LIST_MAX, type DeviceLink } from "./devices.ts";
import { cleanPersona, type Persona } from "./personality.ts";
import { permissionChoices, wellFormedPermission, wellFormedPermReply, wellFormedSettled, type PermissionReply, type PermissionSettled, type PermissionShown } from "./permission.ts";

import { MAX_ROOM_MEMBERS, type RoomMeta } from "./room-rules.ts";

const sealedBox = (x: unknown): boolean =>
  !!x && typeof x === "object" && typeof (x as { iv?: unknown }).iv === "string" && typeof (x as { ct?: unknown }).ct === "string" && (x as { ct: string }).ct.length <= 64_000;
export const POWERS = ["addsAgents", "answersDecisions", "managesAgents"] as const;
export type Power = (typeof POWERS)[number];

export const powerChange = (ev: { power?: Power; on?: boolean; managesAgents?: boolean }): { power: Power; on: boolean } => ({ power: ev.power ?? "managesAgents", on: ev.on ?? !!ev.managesAgents });
export const PROTOCOL_VERSION = 1;

/** Largest ciphertext (base64) the relay accepts for a single message. */
export const MAX_CT_LENGTH = 512 * 1024;
export const MAX_IV_LENGTH = 64;
export const MAX_BODY_LENGTH = 100_000;
export const PAGE_BYTES = 4 * 1024 * 1024;

export const MAX_SNAPSHOT_LENGTH = 512 * 1024;
export const SNAPSHOT_TOO_LARGE = "the snapshot is too large to store";

export const SNAPSHOT_EVERY = 500;

/** Largest raw image (per file) a client will attach: must survive two base64 trips inside this budget. */
export const MAX_IMAGE_BYTES = 256 * 1024;

/** Raster images a message or an icon may carry. SVG is never one: it can carry script. */
export const RASTER_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type RasterMime = (typeof RASTER_MIMES)[number];

/** Whether `mime` is one of the raster types. */
export function isRasterMime(mime: string): mime is RasterMime {
  return (RASTER_MIMES as readonly string[]).includes(mime);
}

/** The robot heads a channel can wear, by colour, in the order the app shows them. */
export const ROBOT_FACES = ["blue", "purple", "red", "lime", "orange", "sky", "mint", "pink", "lilac", "teal", "gold", "coral"] as const;
type RobotFace = (typeof ROBOT_FACES)[number];

/** A channel's icon: one of the robot heads, an emoji, or a small image (never SVG, which can carry script). Sealed like the title. */
export type ChannelIcon = { kind: "robot"; robot: RobotFace } | { kind: "emoji"; emoji: string } | { kind: "image"; mime: RasterMime; data: string };
export const MAX_ICON_BYTES = 32 * 1024;

/** Whether a decrypted icon is one of the two shapes, within limits. */
/** A person's face: a small picture they publish themselves (their GitHub avatar, fetched once by their desktop). */
export type MemberPicture = { mime: RasterMime; data: string };

export const MAX_PICTURE_BYTES = 24 * 1024;

export function wellFormedPicture(x: unknown): x is MemberPicture {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.mime === "string" &&
    isRasterMime(p.mime) &&
    typeof p.data === "string" &&
    p.data.length > 0 &&
    /^[A-Za-z0-9+/]+=*$/.test(p.data) &&
    Math.ceil((p.data.length * 3) / 4) <= MAX_PICTURE_BYTES
  );
}

export function wellFormedIcon(x: unknown): x is ChannelIcon {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  if (i.kind === "robot") return typeof i.robot === "string" && (ROBOT_FACES as readonly string[]).includes(i.robot);
  if (i.kind === "emoji") return typeof i.emoji === "string" && i.emoji.length > 0 && [...new Intl.Segmenter().segment(i.emoji)].length === 1 && i.emoji.length <= 16;
  return i.kind === "image" && typeof i.mime === "string" && isRasterMime(i.mime) && typeof i.data === "string" && Math.ceil((i.data.length * 3) / 4) <= MAX_ICON_BYTES;
}

/** Most images on one message. */
export const MAX_IMAGES = 8;

/** Largest ephemeral (unstored) frame. */
export const MAX_EPH_LENGTH = 4 * 1024;

/** How many messages a room keeps before pruning the oldest. */
export const ROOM_RETENTION = 10_000;

/** Most messages returned by one history read or replayed on connect. */
export const PAGE_LIMIT = 1_000;

export const MORE_REFUSED = "too many page requests; slow down";

export interface SlotTake {
  id: string;
  ttl: number;
}

const SLOT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_SLOT_TTL = 24 * 3_600_000;
const MAX_SLOTS_FREED = 8;

export function wellFormedSlot(x: unknown): x is SlotTake {
  if (!x || typeof x !== "object") return false;
  const t = x as Record<string, unknown>;
  return typeof t.id === "string" && SLOT_ID_RE.test(t.id) && Number.isSafeInteger(t.ttl) && (t.ttl as number) >= 1_000 && (t.ttl as number) <= MAX_SLOT_TTL;
}

export const wellFormedSendId = (x: unknown): x is string => typeof x === "string" && SLOT_ID_RE.test(x);

export function wellFormedFreed(x: unknown): x is string[] {
  return Array.isArray(x) && x.length <= MAX_SLOTS_FREED && x.every((id) => typeof id === "string" && SLOT_ID_RE.test(id));
}

/**
 * WebSocket subprotocol. Clients offer [WS_PROTOCOL, token] so the token
 * travels in a header (browsers can't set Authorization on WebSockets, and
 * query strings end up in logs); the relay answers with WS_PROTOCOL alone.
 */
export const WS_PROTOCOL = "channel-one.v1";

/** Heartbeat frames. The relay answers these without waking the room. */
export const PING = '{"t":"ping"}';
export const PONG = '{"t":"pong"}';

/** A stored message as the relay sees it. */
export interface Envelope {
  seq: number;
  ts: number;
  iv: string;
  ct: string;
  /** Key epoch (membership channels): which channel key sealed this message. */
  e?: number;
}

/** Frames the relay sends over the WebSocket. */
export type ServerFrame =
  | ({ t: "msg" } & Envelope)
  | { t: "eph"; iv: string; ct: string }
  | { t: "ready"; head: number; more: boolean }
  | { t: "ack"; id: string; seq: number; ts?: number }
  | { t: "err"; error: string; id?: string; tag?: string; retryAfter?: number }
  /** Membership channels: the member list changed; refetch it. */
  | { t: "roster" }
  /** Membership channels: the channel key rotated; fetch the new one. */
  | { t: "epoch"; epoch: number }
  /** Membership channels: someone asked to join; the owner should look. */
  | { t: "request" }
  /** The channel's info changed (its icon); refetch it. */
  | { t: "info" }
  /** A member has read everything up to `seq` (their word for it, at the relay's `at`). Older clients ignore it. */
  | ({ t: "read" } & ReadMark)
  /** On connect, before ready: how far each member has read. */
  | { t: "reads"; reads: ReadMark[] }
  | { t: "page" }
  | { t: "head"; seq: number; ts: number };

/** How far one member has read: a seq and when it got there. A number, never content. */
export interface ReadMark {
  pk: string;
  seq: number;
  at: number;
}

/** A read mark as it came off the wire, or null. */
export function wellFormedRead(x: unknown): ReadMark | null {
  const r = x as Partial<ReadMark> | null;
  return r && typeof r.pk === "string" && r.pk.length <= 64 && Number.isSafeInteger(r.seq) && r.seq! > 0 && Number.isSafeInteger(r.at) ? { pk: r.pk, seq: r.seq!, at: r.at! } : null;
}

/**
 * Frames a client sends over the WebSocket. `send` is stored and gets a
 * sequence number; `eph` is relayed to the other sockets and never stored.
 */
export type ClientFrame =
  | { t: "send"; id: string; iv: string; ct: string; e?: number; cid?: string }
  | { t: "eph"; iv: string; ct: string }
  /** This member has read up to `seq` (a listener says it on the socket it already has: cheaper than a request). */
  | { t: "read"; seq: number }
  | { t: "more"; since: number };

/** WebSocket close codes the relay uses for membership changes. */
export const CLOSE_REMOVED = 4403;
export const CLOSE_CLOSED = 4410;

export type GoneHow = "owner" | "left";

export type Verdict = "approved" | "rejected";

export const GONE_WORDS: Record<GoneHow, string> = { owner: "the owner removed this key", left: "this key left the channel" };

export function goneHow(text: string): GoneHow | null {
  if (text.includes(GONE_WORDS.owner)) return "owner";
  if (text.includes(GONE_WORDS.left)) return "left";
  return null;
}

/**
 * Message kinds. Chat kinds carry intent for the reader; "event" marks a
 * coordination event (task, fact, hello, role) whose meaning is in `ev`.
 */
const KINDS = ["msg", "ask", "blocking", "ack", "status", "done", "event"] as const;
export type Kind = (typeof KINDS)[number];
export const CHAT_KINDS: readonly Kind[] = KINDS.filter((k) => k !== "event");

/**
 * A task is open ("todo" on the wire), being done, waiting on its reviewer, or done. "review" only
 * means something for a task with a reviewer.
 */
export const TASK_STATES = ["todo", "doing", "review", "done"] as const;
/** States older clients still send: blocked folds to doing, cancelled to done (see state.ts). */
const OLD_TASK_STATES = ["blocked", "cancelled"] as const;

/**
 * The colours a person can pick: ids, not values (the web app maps each to its
 * light and dark shades), and few enough to tell apart at avatar size. No two
 * people in a channel share one; their agents wear their person's.
 */
export const COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "indigo", "violet", "pink", "brown"] as const;
export type Color = (typeof COLORS)[number];
export const isColor = (x: unknown): x is Color => typeof x === "string" && (COLORS as readonly string[]).includes(x);
export type TaskState = (typeof TASK_STATES)[number];
export type OldTaskState = (typeof OLD_TASK_STATES)[number];

/** Coordination events. Clients fold these, in sequence order, into shared state. */
export type Event =
  | { op: "hello"; role?: string; about?: string }
  /**
   * A task. `review`: who must approve it before it's done (a member's name, or "*" for anyone who hasn't
   * worked on it). Logs from older clients may also carry `after`, `needs` and `handoff`: they're ignored.
   */
  | { op: "task.add"; title: string; detail?: string; owner?: string; review?: string; issue?: IssueRef; from?: number }
  | { op: "task.claim"; task: number }
  | {
      op: "task.update";
      task: number;
      state?: TaskState | OldTaskState;
      owner?: string | null;
      title?: string;
      note?: string;
      review?: string | null;
      claim?: true;
      verdict?: Verdict;
      round?: number;
      at?: string;
      summary?: string;
      body?: "review";
      proof?: { url: string; label?: string };
      areas?: string[];
      checkpoint?: true;
    }
  | { op: "task.first"; task: number }
  /** What a member is and has, said by itself: where it runs, what runs it, what it can use. Shown in People. */
  | ({ op: "card" } & Card)
  /** Claims are gone. Older clients still send these; they fold to nothing. */
  | { op: "claim"; paths: string[]; ttl: number; note?: string; machine?: string; checkout?: string }
  | { op: "release"; paths?: string[] }
  | { op: "fact.set"; key: string; value: string; ttl?: number }
  | { op: "fact.del"; key: string }
  | { op: "lease.take"; name: string; ttl: number; note?: string }
  | { op: "lease.free"; name: string }
  /** The owner, or a person who manages agents (on an agent): set a member's role (and rules), or allow the one they asked for. */
  | { op: "role.set"; member: string; role: string | null; about?: string | null }
  /** The owner, or a person who manages agents (on an agent): turn down the role a member asked for. */
  | { op: "role.refuse"; member: string }
  | { op: "power.set"; member: string; pk: string; power?: Power; on?: boolean; managesAgents?: boolean; was: boolean }
  /** Owner only: a member's seat moved to a new key (fingerprints, for the record). */
  | { op: "seat.reclaim"; member: string; from: string; to: string }
  /** A person's colour (null clears it): set by that person, or by the owner for anyone. */
  | { op: "color.set"; member: string; color: Color | null }
  /** A person's picture (null clears it): set by that person only. */
  | { op: "picture.set"; member: string; picture: MemberPicture | null }
  /**
   * Owner only: what a member may do besides read (null: everything). Names the member's key
   * too, so it never carries over to someone admitted under the same name later.
   */
  | { op: "scope.set"; member: string; pk: string; scopes: string[] | null; lead?: boolean; wasLead?: boolean; keepLead?: true; persona?: Persona | null }
  /** Coordinator-only mode is gone. Older logs still carry these; they fold to nothing. */
  | { op: "mode.set"; coordinatorOnly: boolean; strict: boolean }
  /** Owner only: a room in this channel. Its id never changes; the name is a label (room.rename). */
  | { op: "room.create"; id: string; name: string }
  | { op: "room.seal"; id: string; n: number; keys: string[]; meta: { iv: string; ct: string }; proof?: string }
  | { op: "room.msg"; room: string; n: number; iv: string; ct: string }
  /** Owner only: a room's new name ("general" included; its id stays). */
  | { op: "room.rename"; id: string; name: string }
  /**
   * Owner only: what this channel is for and where its limits are (null clears it). Every agent is
   * shown it as the scope it works within; a request outside it is escalated to a person, not done.
   */
  | { op: "charter.set"; text: string | null }
  | { op: "compact.propose"; summary: string; through: number }
  | { op: "compact"; summary: string; through: number; proposal?: number }
  | { op: "repos.set"; repos: string[] }
  | { op: "github"; items: GithubNote[] }
  /** Owner only: what a connected repo asks before a pull request merges into its default branch, read from GitHub by the owner's app. */
  | { op: "github.rules"; repo: string; branch: string; required: string[]; merge: MergeMethod[] }
  /** Owner only: a published GitHub release of a connected repo, with the commits it added (shas, and the PR numbers their messages name), read by the owner's app. */
  | { op: "github.release"; repo: string; tag: string; at: number; shas: string[]; prs: number[] }
  /**
   * Owner only: stop every agent (on) or let them carry on (off). While on hold, every client refuses
   * an agent's work (tasks, facts, messages to other agents); agents may still answer people.
   */
  | { op: "hold.set"; on: boolean; note?: string }
  | { op: "voice.set"; on: boolean }
  | { op: "github.write.set"; on: boolean }
  | { op: "branch.prefix.set"; prefix: string | null }
  /** The goal a person's message #ask stands for, in plain words, as its tasks' header (null: their own words again). The lead, the owner or who asked names it. */
  | { op: "ask.name"; ask: number; name: string | null }
  | { op: "ask.close"; ask: number; why?: string }
  | { op: "devices"; links: DeviceLink[] }
  /**
   * A member's reaction to message #seq: one short emoji per member per message, the latest wins, null
   * takes it back. Not news: it's no unread, no notification, no line in a feed. Its body is throwaway
   * (an older client drops the whole message, body and all, as malformed).
   */
  | { op: "react"; seq: number; emoji: string | null };

/** The longest reaction, in UTF-16 units: one emoji, family sequences and flags included. */
const MAX_REACTION = 16;
const GIF_REACTION_RE = /^[a-z0-9][a-z0-9-]{0,23}\/[a-z0-9][a-z0-9-]{0,47}$/;

/** Whether `x` can be a reaction: a short single line with something to see (no letters spelling words, no markup). */
export function wellFormedReaction(x: unknown): x is string {
  if (typeof x !== "string") return false;
  if (GIF_REACTION_RE.test(x)) return true;
  return x.length > 0 && x.length <= MAX_REACTION && x.trim() === x && !/[\u0000-\u001f\u007f<>&"'`\\]/.test(x) && !/[\p{L}\p{N}]/u.test(x);
}

export function isGifReaction(x: string): boolean {
  return GIF_REACTION_RE.test(x);
}

/** A reaction event, which feeds, unread counts and notifications leave out. */
export function isReaction(m: Pick<Message, "kind" | "ev">): boolean {
  return m.kind === "event" && m.ev?.op === "react";
}

const QUIET_OPS: ReadonlySet<string> = new Set([
  "hello",
  "card",
  "picture.set",
  "react",
  "fact.set",
  "fact.del",
  "lease.take",
  "lease.free",
  "task.claim",
  "claim",
  "release",
  "github.rules",
  "github.release",
  "devices",
]);

export const isRunning = (i: GithubNote): boolean => (i.event === "check_run" || i.event === "workflow_run") && i.conclusion === undefined;

const onlyRunning = (items: readonly GithubNote[]): boolean => items.length > 0 && items.every(isRunning);

export function isQuiet(m: Pick<Message, "kind" | "ev" | "newer">): boolean {
  return m.kind === "event" && (m.newer !== undefined || (!!m.ev && (QUIET_OPS.has(m.ev.op) || (m.ev.op === "github" && onlyRunning(m.ev.items)))));
}

/** What a member says about itself (see the card event). Every field is optional and short. */
export interface Card {
  /** macos, windows, linux. */
  os?: string;
  /** arm64, x64. */
  arch?: string;
  /** What runs the agent: claude-code, codex, gemini, cursor, grok, or anything else. */
  harness?: string;
  /** The model it runs on, as its harness names it (claude-opus-4-1, gpt-5-codex, grok-4…). */
  model?: string;
  /** The machine's CPU ("10 cores · Apple M1 Pro") and memory ("32 GB"): what it can take on. */
  cpu?: string;
  memory?: string;
  /** Tools and capabilities on its machine: docker, gpu, xcode, cargo… */
  tools?: string[];
  /** The repository it works in ("owner/repo") and the branch it's on. */
  repo?: string;
  branch?: string;
  /** Anything else worth knowing about it, in its own words. */
  note?: string;
  fresh?: number;
}

/** Most tools a card lists. */
export const MAX_TAGS = 40;

/**
 * A card as someone else said it (a join request carries the asker's): only the fields a card has,
 * each a short single line, tools capped. Anything else is dropped; null when nothing's left.
 */
export function cleanCard(x: unknown): Card | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const line = (v: unknown, max: number) =>
    typeof v === "string"
      ? v
          .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
          .trim()
          .slice(0, max)
      : "";
  const out: Card = {};
  for (const k of ["os", "arch", "harness", "model", "cpu", "memory", "repo", "branch"] as const) {
    const v = line(r[k], 120);
    if (v) out[k] = v;
  }
  const note = line(r.note, 500);
  if (note) out.note = note;
  if (Array.isArray(r.tools)) {
    const tools = r.tools
      .map((t) => line(t, 40))
      .filter(Boolean)
      .slice(0, MAX_TAGS);
    if (tools.length) out.tools = tools;
  }
  return Object.keys(out).length ? out : null;
}

/** Longest charter, in characters: it shares the sealed settings (about 16KB at the relay) with the room list. */
export const MAX_CHARTER = 2000;

export const MAX_SUMMARY = 8000;

export const GITHUB_EVENTS = ["pull_request", "check_run", "push", "workflow_run", "issues"] as const;
export const MAX_GITHUB_ITEMS = 50;

export interface GithubNote {
  event: (typeof GITHUB_EVENTS)[number];
  repo: string;
  action?: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  merged?: boolean;
  additions?: number;
  deletions?: number;
  files?: number;
  run?: number;
  attempt?: number;
  branch?: string;
  sha?: string;
  merge?: string;
  name?: string;
  status?: string;
  conclusion?: string;
  reason?: string;
  by?: string;
  at: number;
}

export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];
export const MAX_REQUIRED_CHECKS = 50;
export const MAX_RELEASE_COMMITS = 250;
const SHA_RE = /^[0-9a-f]{7,40}$/;

export interface IssueRef {
  repo: string;
  number: number;
}

export const MAX_AREAS = 20;
const AREA_RE = /^(?!(?:.*\/)?\.\.?(?:\/|$))[\w.@+-]+(?:\/[\w.@+-]+)*$/;

const isAreas = (x: unknown): x is string[] => Array.isArray(x) && x.length <= MAX_AREAS && x.every((a) => typeof a === "string" && a.length <= 120 && AREA_RE.test(a));

function isIssueRef(x: unknown): x is IssueRef {
  const r = x as { repo?: unknown; number?: unknown } | null;
  return !!r && typeof r === "object" && typeof r.repo === "string" && REPO_RE.test(r.repo) && Number.isSafeInteger(r.number) && (r.number as number) > 0;
}

const GITHUB_TEXT: Record<string, number> = { action: 40, title: 200, url: 300, state: 20, branch: 200, sha: 40, merge: 40, name: 200, status: 20, conclusion: 20, reason: 20, by: 100 };

export function cleanGithubNote(x: unknown): GithubNote | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (!(GITHUB_EVENTS as readonly unknown[]).includes(r.event) || typeof r.repo !== "string" || !REPO_RE.test(r.repo)) return null;
  if (typeof r.at !== "number" || !Number.isSafeInteger(r.at) || r.at < 0) return null;
  const out: Record<string, unknown> = { event: r.event, repo: r.repo, at: r.at };
  for (const [k, max] of Object.entries(GITHUB_TEXT)) {
    const v = r[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) return null;
    out[k] = v;
  }
  if (out.url !== undefined && !handoffUrl(out.url)) return null;
  if (r.number !== undefined) {
    if (typeof r.number !== "number" || !Number.isSafeInteger(r.number) || r.number <= 0) return null;
    out.number = r.number;
  }
  if (r.merged !== undefined) {
    if (typeof r.merged !== "boolean") return null;
    out.merged = r.merged;
  }
  for (const k of ["additions", "deletions", "files", "run", "attempt"] as const) {
    const v = r[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return null;
    out[k] = v;
  }
  return out as unknown as GithubNote;
}

export const MAX_REPOS = 20;
export const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const BRANCH_PREFIX_RE = /^[A-Za-z0-9_./-]{1,32}$/;

/** The room every channel has, and where a message that names none belongs (every message from before rooms). */
export const LEASE_NAME_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/;
export const MAX_LEASE_SECONDS = 24 * 3600;
const leaseName = (x: unknown): x is string => typeof x === "string" && LEASE_NAME_RE.test(x);

export const GENERAL_ROOM = "general";
/** A room id: chosen once by the owner's client, never changed, so a room can later move without breaking references. */
export const ROOM_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Longest room name. */
export const MAX_ROOM_NAME = 40;
export const MAX_GOAL_NAME = 80;
/** Most rooms a channel holds (general included): the list must fit the sealed settings. */
export const MAX_ROOMS = 50;

/** One image attached to a message, encrypted with everything else. */
export interface ImageAttachment {
  name: string;
  /** A raster type from `RASTER_MIMES`. Never SVG. */
  mime: string;
  /** Raw bytes, base64. */
  data?: string;
  ref?: ImageRef;
}

interface ImageRef {
  id: string;
  key: string;
  size: number;
}

export type InlineImage = ImageAttachment & { data: string };

export const MAX_BLOB_BYTES = MAX_IMAGE_BYTES + 28;

export const BLOB_ID_RE = /^[0-9a-f]{64}$/;

function wellFormedRef(x: unknown): x is ImageRef {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    BLOB_ID_RE.test(r.id) &&
    typeof r.key === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(r.key) &&
    Number.isSafeInteger(r.size) &&
    (r.size as number) >= 0 &&
    (r.size as number) <= MAX_IMAGE_BYTES
  );
}

/** An attachment worth keeping: a named raster image. Anything else (including SVG) is dropped. */
export function rasterAttachment(x: unknown): x is ImageAttachment {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return typeof i.name === "string" && typeof i.mime === "string" && isRasterMime(i.mime) && (typeof i.data === "string" || (i.data === undefined && wellFormedRef(i.ref)));
}

function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
}

/** One-line marker for an image, e.g. `[image: shot.png (84KB)]`. */
export function imageMarker(img: Pick<ImageAttachment, "name" | "data" | "ref">): string {
  return `[image: ${img.name} (${kb(img.data !== undefined ? Math.ceil((img.data.length * 3) / 4) : (img.ref?.size ?? 0))})]`;
}

const HANDOFF_MAX_URL = 2048;
export const HANDOFF_MAX_VENDOR = 40;
export const HANDOFF_DEFAULT_SECONDS = 600;
export const HANDOFF_MAX_SECONDS = 3600;
export const HANDOFF_DONE = "handoff: done";
export const HANDOFF_FAILED = "handoff: failed";

export interface Handoff {
  url: string;
  vendor: string;
  expiresAt: number;
  mode?: "tab" | "full";
}

function unsafeChar(c: string): boolean {
  const n = c.codePointAt(0) ?? 0;
  return n <= 0x20 || (n >= 0x7f && n <= 0x9f) || (n >= 0x2028 && n <= 0x202e) || (n >= 0x2060 && n <= 0x2069);
}

export function handoffUrl(x: unknown): x is string {
  if (typeof x !== "string" || x.length === 0 || x.length > HANDOFF_MAX_URL) return false;
  try {
    const u = new URL(x);
    return u.protocol === "https:" && !u.username && !u.password && ![...x].some(unsafeChar);
  } catch {
    return false;
  }
}

export function wellFormedHandoff(x: unknown): x is Handoff {
  if (!x || typeof x !== "object") return false;
  const h = x as Record<string, unknown>;
  return handoffUrl(h.url) && str(h.vendor, HANDOFF_MAX_VENDOR) && time(h.expiresAt) && (h.mode === undefined || h.mode === "tab" || h.mode === "full");
}

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_TITLE_LIMIT = 60;
export const TASK_BODY_MAX_LENGTH = 10_000;
export const PROOF_URL_MAX_LENGTH = 2000;
export const PROOF_LABEL_MAX_LENGTH = 80;
export const PROOF_MAX = 50;
export const CHECKPOINT_MAX_LENGTH = 4000;
export const REVIEW_SUMMARY_MAX_LENGTH = 4000;
export const DECISION_KINDS = ["intent", "taste", "irreversible", "scope", "choice"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];
export const MAX_HOLDS = 20;
export const wellFormedHolds = (x: unknown): x is number[] => Array.isArray(x) && x.length > 0 && x.length <= MAX_HOLDS && x.every((y) => Number.isSafeInteger(y) && y > 0);
export const isDecisionKind = (x: unknown): x is DecisionKind => DECISION_KINDS.some((k) => k === x);
export const CHOICES_MIN = 2;
export const CHOICES_MAX = 6;
export const CHOICE_MAX_LENGTH = 200;
const STEP_ITEMS_MAX = 20;
const STEP_LINKS_MAX = 10;

export interface Step {
  why: string;
  needsPerson: string;
  do?: string[];
  run?: string[];
  expect?: string;
  links?: string[];
}

type StepOutcome = "done" | "cant" | "not-needed";

export interface StepReply {
  outcome: StepOutcome;
  output?: string;
  reason?: string;
}

const stepText = (x: unknown, max: number): x is string => str(x, max) && x.trim().length > 0;
const stepItems = (x: unknown, max: number): x is string[] => Array.isArray(x) && x.length > 0 && x.length <= STEP_ITEMS_MAX && x.every((item) => stepText(item, max));

function wellFormedStep(x: unknown): x is Step {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    stepText(s.why, 4000) &&
    stepText(s.needsPerson, 4000) &&
    (s.do === undefined || stepItems(s.do, 4000)) &&
    (s.run === undefined || stepItems(s.run, 10_000)) &&
    (s.expect === undefined || stepText(s.expect, 4000)) &&
    (s.links === undefined || (Array.isArray(s.links) && s.links.length > 0 && s.links.length <= STEP_LINKS_MAX && s.links.every(handoffUrl))) &&
    stepItems(s.do ?? s.run ?? s.links, 10_000)
  );
}

function wellFormedStepReply(x: unknown): x is StepReply {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (r.outcome === "done") return r.reason === undefined && (r.output === undefined || stepText(r.output, MAX_BODY_LENGTH));
  return (r.outcome === "cant" || r.outcome === "not-needed") && r.output === undefined && stepText(r.reason, 4000);
}

export function wellFormedChoices(x: unknown): x is string[] {
  if (!Array.isArray(x) || x.length < CHOICES_MIN || x.length > CHOICES_MAX) return false;
  if (!x.every((c) => typeof c === "string" && c.trim().length > 0 && c.length <= CHOICE_MAX_LENGTH && !/[\r\n]/.test(c))) return false;
  return new Set(x.map((c: string) => c.trim().toLowerCase())).size === x.length;
}

export function decisionNeedsStep(choices: readonly string[] | undefined): boolean {
  if (choices?.length !== 2) return false;
  const [done, waiting] = choices.map((choice) =>
    choice
      .replace(/^[A-Z]\s*[:.)-]\s*/i, "")
      .trim()
      .toLowerCase(),
  );
  return /^done(?:\s|$)/.test(done!) && /^not yet(?:\s|$)/.test(waiting!);
}

/** The decrypted message body. */
export interface Payload {
  v: typeof PROTOCOL_VERSION;
  id: string;
  from: string;
  ops?: number;
  /** Recipients by agent name; omitted means everyone. */
  to?: string[];
  kind: Kind;
  /** Human-readable text. For events, a one-line summary. */
  body: string;
  /** Sequence numbers this message replies to. */
  re?: number[];
  ev?: Event;
  /** Attached images, in order. Never present on events. */
  imgs?: ImageAttachment[];
  /** The room a chat message is in (a room id); absent is general. Events are channel-wide. */
  room?: string;
  /**
   * A chat message in task N's thread (see placeOf in state.ts). Older clients don't know the field and
   * show the message in their main view, so nothing is refused or lost.
   */
  task?: number;
  /** A chat message to exactly one member, in the direct thread between the two. Older clients see a message to that member. */
  dm?: true;
  /**
   * An agent handing a decision or a step to people instead of acting (`kiwi escalate`): a blocking
   * question to its own human and the owner. Older clients see it as the blocking question it also is.
   */
  esc?: true;
  handoff?: Handoff;
  choices?: string[];
  holds?: number[];
  decision?: DecisionKind;
  step?: Step;
  stepReply?: StepReply;
  permission?: PermissionShown;
  perm?: PermissionReply;
  settled?: PermissionSettled;
  ts: number;
  /** Sender's Ed25519 public key (raw, base64url) and signature over the rest. */
  pk?: string;
  sig?: string;
}

/**
 * How far to trust who a message says it's from:
 *   verified   signed by the key the owner admitted under that name
 *   forged     anything else: another key, no signature, or not a member
 *   refused    signed by that member, but against what the owner allows: outside its scopes, an
 *              escalation to the wrong people, or work during a hold
 */
export type Trust = "verified" | "forged" | "refused";

/** Whether a message is one to leave out: forged, or against what the owner allows. */
export function ignored(trust: Trust | undefined): boolean {
  return trust === "forged" || trust === "refused";
}

export interface NewerEvent {
  readonly op: string;
  readonly [field: string]: unknown;
}

export type WirePayload = Omit<Payload, "ev"> & { ev?: Event | NewerEvent };

export const EVENT_OPS_VERSION = 9;

export const PRIVATE_ROOM_OPS = 9;

export const opsVersion = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 1 && (x as number) <= 10_000;
const NEWER_OP_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export const knownOp = (op: string): boolean => eventCheck({ op }) !== null;

export const isEvent = (ev: Event | NewerEvent): ev is Event => eventCheck(ev) !== null;

function wellFormedNewer(ev: unknown): ev is NewerEvent {
  if (!ev || typeof ev !== "object") return false;
  const op = (ev as Record<string, unknown>).op;
  return typeof op === "string" && op.length <= 40 && NEWER_OP_RE.test(op) && eventCheck(ev) === null;
}

export function asSent(m: Message): Omit<Message, "newer" | "ev"> & { ev?: Event | NewerEvent } {
  const { newer, ev, ...rest } = m;
  return { ...rest, ...(newer ? { ev: newer } : ev ? { ev } : {}) };
}

export const outgrown = (base: { folded?: number; skipped?: true }): boolean => base.skipped === true && (base.folded ?? 0) < EVENT_OPS_VERSION;

export const FOLD_RULES = 8;

export const olderRules = (base: { rules?: number }): boolean => (base.rules ?? 0) < FOLD_RULES;

export const decodedWhole = (page: { head: number; messages: readonly { seq: number }[] }): boolean =>
  page.head > 0 && page.messages.length === page.head && page.messages[0]?.seq === 1 && page.messages.at(-1)?.seq === page.head;

export interface Message extends Payload {
  newer?: NewerEvent;
  opened?: RoomMeta;
  proven?: boolean;
  sealed?: { room: string; n: number };
  seq: number;
  /** When the relay stored it (one clock for everyone, unlike `ts`). */
  rts?: number;
  /** Signature checks out for `pk` (binding pk to the name is the fold's job). */
  sigOk: boolean;
}

/**
 * What an agent is doing right now, as its harness tells its listener on its machine (harness.ts):
 * working (with the running tool's name, never its input), waiting on a person, or idle; its model.
 */
export interface Activity {
  state: "working" | "waiting" | "idle";
  tool?: string;
  model?: string;
  /** Since when, as the harness says (ms). */
  since?: number;
  context?: ContextUse;
}

export interface ContextUse {
  used: number;
  window?: number;
}

const CONTEXT_TOKENS_MAX = 100_000_000;
export const CONTEXT_LINE = 250_000;

function contextUse(x: unknown): ContextUse | undefined {
  if (!x || typeof x !== "object") return undefined;
  const r = x as Record<string, unknown>;
  const tokens = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= CONTEXT_TOKENS_MAX ? v : undefined);
  const used = tokens(r.used);
  const window = tokens(r.window);
  return used ? { used, ...(window ? { window } : {}) } : undefined;
}

/** An activity as someone else said it: only its fields, each short; null when it isn't one. */
export function cleanActivity(x: unknown): Activity | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  if (r.state !== "working" && r.state !== "waiting" && r.state !== "idle") return null;
  const line = (v: unknown, max: number) =>
    typeof v === "string"
      ? v
          .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
          .trim()
          .slice(0, max)
      : "";
  const tool = line(r.tool, 60);
  const model = line(r.model, 120);
  const since = typeof r.since === "number" && Number.isFinite(r.since) ? r.since : undefined;
  const context = contextUse(r.context);
  return { state: r.state, ...(tool ? { tool } : {}), ...(model ? { model } : {}), ...(since ? { since } : {}), ...(context ? { context } : {}) };
}

export type Reach = "listening" | "running" | "unreachable";

export function isReach(x: unknown): x is Reach {
  return x === "listening" || x === "running" || x === "unreachable";
}

/** Ephemeral, unstored payloads: presence beacons and queries. */
export interface Presence {
  v: typeof PROTOCOL_VERSION;
  type: "presence";
  from: string;
  /** What the sender's listener is: "tail", "wait", "mcp", "web". */
  client: string;
  /** Ask everyone listening to announce themselves. */
  query?: boolean;
  /** What the agent is doing right now, when its harness says (read through cleanActivity). */
  activity?: Activity;
  reach?: Reach;
  readAt?: number;
  wake?: string;
  ops?: number;
  ts: number;
  pk?: string;
  sig?: string;
}

const str = (x: unknown, max = 10_000): x is string => typeof x === "string" && x.length <= max;
const strs = (x: unknown, n: number): x is string[] => Array.isArray(x) && x.length <= n && x.every((y) => str(y, 512));
const nums = (x: unknown, n: number): x is number[] => Array.isArray(x) && x.length <= n && x.every((y) => Number.isSafeInteger(y) && y >= 0);
const opt = <T>(x: unknown, ok: (v: unknown) => v is T): boolean => x === undefined || ok(x);
const time = (x: unknown): x is number => typeof x === "number" && Number.isFinite(new Date(x).getTime());

const roomId = (x: unknown): x is string => typeof x === "string" && ROOM_ID_RE.test(x);

const tags = (x: unknown): x is string[] => Array.isArray(x) && x.length <= MAX_TAGS && x.every((y) => str(y, 40));

/** Whether an event has the shape its op promises (anything else is dropped, not folded). */
export function wellFormedEvent(ev: unknown): ev is Event {
  return eventCheck(ev) === true;
}

function eventCheck(ev: unknown): boolean | null {
  if (!ev || typeof ev !== "object") return false;
  const e = ev as Record<string, unknown>;
  const n = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
  switch (e.op) {
    case "hello":
      return opt(e.role, (x): x is string => str(x, 200)) && opt(e.about, (x): x is string => str(x, 2000));
    case "task.add":
      return (
        str(e.title, 500) &&
        opt(e.detail, (x): x is string => str(x, TASK_BODY_MAX_LENGTH)) &&
        opt(e.owner, (x): x is string => str(x, 64)) &&
        opt(e.review, (x): x is string => str(x, 64)) &&
        opt(e.issue, isIssueRef) &&
        opt(e.from, (x): x is number => Number.isSafeInteger(x) && (x as number) > 0)
      );
    case "task.claim":
    case "task.first":
      return n(e.task);
    case "task.update":
      return (
        n(e.task) &&
        opt(e.state, (x): x is string => typeof x === "string" && ([...TASK_STATES, ...OLD_TASK_STATES] as readonly string[]).includes(x)) &&
        (e.owner === undefined || e.owner === null || str(e.owner, 64)) &&
        opt(e.title, (x): x is string => str(x, 500)) &&
        opt(e.note, (x): x is string => str(x)) &&
        (e.review === undefined || e.review === null || str(e.review, 64)) &&
        (e.claim === undefined || (e.claim === true && typeof e.review === "string")) &&
        (e.verdict === undefined || e.verdict === "approved" || e.verdict === "rejected") &&
        (e.round === undefined || (Number.isSafeInteger(e.round) && (e.round as number) > 0)) &&
        opt(e.at, (x): x is string => str(x, 200) && x.trim().length > 0 && !/[\r\n]/.test(x)) &&
        (e.summary === undefined || (e.state === "review" && str(e.summary, REVIEW_SUMMARY_MAX_LENGTH) && e.summary.trim().length > 0)) &&
        (e.body === undefined || (e.body === "review" && e.verdict !== undefined)) &&
        opt(e.areas, isAreas) &&
        (e.checkpoint === undefined || (e.checkpoint === true && str(e.note, CHECKPOINT_MAX_LENGTH) && e.note.trim().length > 0)) &&
        opt(e.proof, (x): x is { url: string; label?: string } => {
          const p = x as { url?: unknown; label?: unknown } | null;
          return (
            !!p &&
            typeof p === "object" &&
            str(p.url, PROOF_URL_MAX_LENGTH) &&
            /^https:\/\/[^\s]+$/.test(p.url) &&
            opt(p.label, (l): l is string => str(l, PROOF_LABEL_MAX_LENGTH) && !/[\r\n]/.test(l))
          );
        })
      );
    case "card":
      return (
        ["os", "arch", "harness", "model", "cpu", "memory", "repo", "branch"].every((k) => opt(e[k], (x): x is string => str(x, 120))) &&
        opt(e.tools, (x): x is string[] => tags(x)) &&
        opt(e.note, (x): x is string => str(x, 500)) &&
        opt(e.fresh, (x): x is number => Number.isSafeInteger(x) && (x as number) >= 0)
      );
    case "claim":
      return (
        strs(e.paths, 100) &&
        (e.paths as string[]).length > 0 &&
        Number.isFinite(e.ttl) &&
        (e.ttl as number) > 0 &&
        opt(e.note, (x): x is string => str(x, 500)) &&
        opt(e.machine, (x): x is string => str(x, 80)) &&
        opt(e.checkout, (x): x is string => str(x, 2000))
      );
    case "release":
      return opt(e.paths, (x): x is string[] => strs(x, 100));
    case "fact.set":
      return str(e.key, 200) && str(e.value, 10_000) && opt(e.ttl, (x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
    case "fact.del":
      return str(e.key, 200);
    case "lease.take":
      return leaseName(e.name) && Number.isSafeInteger(e.ttl) && (e.ttl as number) >= 60 && (e.ttl as number) <= MAX_LEASE_SECONDS && opt(e.note, (x): x is string => str(x, 500));
    case "lease.free":
      return leaseName(e.name);
    case "role.set":
      return str(e.member, 64) && (e.role === null || str(e.role, 200)) && (e.about === undefined || e.about === null || str(e.about, 2000));
    case "role.refuse":
      return str(e.member, 64);
    case "power.set":
      return (
        str(e.member, 64) &&
        str(e.pk, 64) &&
        typeof e.was === "boolean" &&
        (e.power === undefined ? typeof e.managesAgents === "boolean" : (POWERS as readonly unknown[]).includes(e.power) && typeof e.on === "boolean")
      );
    case "seat.reclaim":
      return str(e.member, 64) && str(e.from, 64) && str(e.to, 64);
    case "color.set":
      return str(e.member, 64) && (e.color === null || isColor(e.color));
    case "picture.set":
      return str(e.member, 64) && (e.picture === null || wellFormedPicture(e.picture));
    case "scope.set":
      return (
        str(e.member, 64) &&
        str(e.pk, 64) &&
        (e.scopes === null || strs(e.scopes, 32)) &&
        (e.keepLead === undefined || (e.keepLead === true && e.lead === undefined)) &&
        (e.lead === undefined ? e.wasLead === undefined : typeof e.lead === "boolean" && typeof e.wasLead === "boolean") &&
        (e.persona === undefined || e.persona === null || cleanPersona(e.persona) !== null)
      );
    case "mode.set":
      return typeof e.coordinatorOnly === "boolean" && typeof e.strict === "boolean";
    case "room.seal":
      return (
        roomId(e.id) &&
        Number.isSafeInteger(e.n) &&
        (e.n as number) >= 1 &&
        Array.isArray(e.keys) &&
        e.keys.length >= 1 &&
        e.keys.length <= MAX_ROOM_MEMBERS &&
        e.keys.every((k) => str(k, 400)) &&
        sealedBox(e.meta) &&
        opt(e.proof, (x): x is string => str(x, 100))
      );
    case "room.msg":
      return roomId(e.room) && Number.isSafeInteger(e.n) && (e.n as number) >= 1 && str(e.iv, 32) && str(e.ct, MAX_BODY_LENGTH * 2);
    case "room.create":
    case "room.rename":
      return roomId(e.id) && str(e.name, MAX_ROOM_NAME * 4);
    case "charter.set":
      return e.text === null || str(e.text, MAX_CHARTER);
    case "compact.propose":
      return str(e.summary, MAX_SUMMARY) && !!(e.summary as string).trim() && n(e.through) && (e.through as number) > 0;
    case "compact":
      return str(e.summary, MAX_SUMMARY) && !!(e.summary as string).trim() && n(e.through) && (e.through as number) > 0 && opt(e.proposal, (x): x is number => n(x) && x > 0);
    case "github":
      return Array.isArray(e.items) && e.items.length > 0 && e.items.length <= MAX_GITHUB_ITEMS && e.items.every((i) => cleanGithubNote(i) !== null);
    case "github.rules":
      return (
        typeof e.repo === "string" &&
        REPO_RE.test(e.repo) &&
        str(e.branch, 200) &&
        !!(e.branch as string).trim() &&
        Array.isArray(e.required) &&
        e.required.length <= MAX_REQUIRED_CHECKS &&
        e.required.every((c) => str(c, 200) && !!c.trim() && !/[\u0000-\u001f\u007f]/.test(c)) &&
        Array.isArray(e.merge) &&
        e.merge.every((m) => (MERGE_METHODS as readonly unknown[]).includes(m))
      );
    case "github.release":
      return (
        typeof e.repo === "string" &&
        REPO_RE.test(e.repo) &&
        str(e.tag, 200) &&
        !!(e.tag as string).trim() &&
        !/[\u0000-\u001f\u007f]/.test(e.tag as string) &&
        n(e.at) &&
        Array.isArray(e.shas) &&
        e.shas.length <= MAX_RELEASE_COMMITS &&
        e.shas.every((s) => typeof s === "string" && SHA_RE.test(s)) &&
        Array.isArray(e.prs) &&
        e.prs.length <= MAX_RELEASE_COMMITS &&
        e.prs.every((p) => n(p) && (p as number) > 0)
      );
    case "repos.set":
      return Array.isArray(e.repos) && e.repos.length <= MAX_REPOS && e.repos.every((r) => typeof r === "string" && REPO_RE.test(r));
    case "hold.set":
      return typeof e.on === "boolean" && opt(e.note, (x): x is string => str(x, 500));
    case "voice.set":
    case "github.write.set":
      return typeof e.on === "boolean";
    case "branch.prefix.set":
      return e.prefix === null || (typeof e.prefix === "string" && BRANCH_PREFIX_RE.test(e.prefix));
    case "react":
      return n(e.seq) && (e.seq as number) > 0 && (e.emoji === null || wellFormedReaction(e.emoji));
    case "ask.name":
      return n(e.ask) && (e.ask as number) > 0 && (e.name === null || str(e.name, MAX_GOAL_NAME * 4));
    case "ask.close":
      return n(e.ask) && (e.ask as number) > 0 && (e.why === undefined || str(e.why, 500));
    case "devices":
      return Array.isArray(e.links) && e.links.length > 0 && e.links.length <= DEVICE_LIST_MAX && e.links.every((l) => !!l && typeof l === "object" && !Array.isArray(l));
    default:
      return null;
  }
}

/** Whether a decrypted payload has the shape every client relies on. Malformed ones are dropped. */
export function wellFormed(p: unknown): p is WirePayload {
  if (!p || typeof p !== "object") return false;
  const m = p as Record<string, unknown>;
  return (
    m.v === PROTOCOL_VERSION &&
    str(m.id, 100) &&
    str(m.from, 64) &&
    str(m.body, MAX_BODY_LENGTH) &&
    typeof m.kind === "string" &&
    (KINDS as readonly string[]).includes(m.kind) &&
    time(m.ts) &&
    opt(m.ops, opsVersion) &&
    opt(m.to, (x): x is string[] => strs(x, 50)) &&
    opt(m.re, (x): x is number[] => nums(x, 20)) &&
    opt(m.room, roomId) &&
    (m.task === undefined || (Number.isSafeInteger(m.task) && (m.task as number) > 0)) &&
    (m.dm === undefined || m.dm === true) &&
    (m.esc === undefined || m.esc === true) &&
    (m.handoff === undefined || (m.esc === true && wellFormedHandoff(m.handoff))) &&
    (m.choices === undefined || (m.esc === true && m.handoff === undefined && wellFormedChoices(m.choices))) &&
    (m.holds === undefined || (m.esc === true && wellFormedHolds(m.holds))) &&
    (m.decision === undefined || (m.esc === true && isDecisionKind(m.decision))) &&
    (m.step === undefined || (m.esc === true && m.handoff === undefined && m.choices === undefined && m.decision === undefined && wellFormedHolds(m.holds) && wellFormedStep(m.step))) &&
    (m.stepReply === undefined || (m.kind !== "event" && Array.isArray(m.re) && m.re.length > 0 && wellFormedStepReply(m.stepReply))) &&
    (m.permission === undefined || (m.esc === true && permissionChoices(m.choices) && wellFormedPermission(m.permission))) &&
    (m.perm === undefined || (m.kind !== "event" && Array.isArray(m.re) && m.re.length > 0 && wellFormedPermReply(m.perm))) &&
    (m.settled === undefined || (m.kind !== "event" && Array.isArray(m.re) && m.re.length > 0 && wellFormedSettled(m.settled))) &&
    (m.ev === undefined || wellFormedEvent(m.ev) || wellFormedNewer(m.ev)) &&
    (m.kind !== "event" || m.ev !== undefined)
  );
}
