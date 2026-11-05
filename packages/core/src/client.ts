// Client for one membership channel: create it, ask to join, approve, send
// (signed), read history, stream live messages and presence, leave, close.
// Runs in Bun and in the browser.
//
// On Effect inside (docs/plans/effect.md, step 3). Every request goes through the
// Relay service; a refusal is a typed failure (RelayError, ChannelGone,
// Unreachable), never a message to match. The live connection is a Stream that
// reconnects on a Schedule, and interrupting it closes the socket. `ch.fx`,
// `Channel.fx` and `fx` are those Effects. The Promise methods, which the CLI, the
// agent and the dashboard call, run them and resolve or reject exactly as before.

import type { Persona, Personality } from "./personality.ts";
import { fromBase64, newRoomId, toBase64, type ChannelAccess } from "./crypto.ts";
import type { Identity } from "./identity.ts";
import type { JoinClaims, JoinRequest, Member, MemberInfo, PersonPowers } from "./membership.ts";
import { isPerson, personOf, sentTo, withSeats, type RoomMember } from "./room-rules.ts";
import type { Marks } from "./note.ts";
import { GENERAL_ROOM, type ChannelIcon, type Envelope, type FileAttachment, type ImageAttachment, type InlineImage, type Message } from "./protocol.ts";
import type { Scope } from "./scopes.ts";
import type { GithubStatus } from "./github-health.ts";
import type { FoldBase, GithubRelease, GithubRules, GithubState, GuardFloor } from "./state.ts";
import { ChannelCore, type ChannelFx } from "./client/core.ts";
import { ChannelDelegations, type Computer, type Tended } from "./client/delegations.ts";
import { ChannelGithub, type GithubDiff, type GithubIssueInfo, type ReviewCheck } from "./client/github.ts";
import { ChannelHistory } from "./client/history.ts";
import { ChannelFiles } from "./client/files.ts";
import { ChannelImages } from "./client/images.ts";
import { ChannelInfo, type Info, type MemberRow } from "./client/info.ts";
import { joinFx, type JoinStatus, type JoinWatch } from "./client/join.ts";
import { ChannelKeys } from "./client/keys.ts";
import { ChannelLive, type StreamOptions } from "./client/live.ts";
import type { DocStore } from "./doc/hub.ts";
import type { ThreadDoc } from "./doc/thread-doc.ts";
import { ChannelMembers, type Keeps, type Reconciled } from "./client/members.ts";
import { run, runUntil } from "./client/relay.ts";
import { ChannelRequests, type RequestsOptions } from "./client/requests.ts";
import type { Delegation } from "./delegation.ts";
import type { DeviceList } from "./devices.ts";
import { ChannelSending, type SendOptions } from "./client/send.ts";
import { ChannelSettings, type RoomsSetting } from "./client/settings.ts";
import { ChannelSnapshots, type DocsPruned, type DocStat } from "./client/snapshots.ts";

const COMPACT_WAIT_MS = 30_000;

export { ChannelGone, goneText, RelayError, Unreachable, type Refused } from "./client/errors.ts";
export type { DocsPruned, DocStat } from "./client/snapshots.ts";
export { downWhy, fetchRelay, keepAnswersIn, OfflineReads, Relay, relayConfig, relayDown, settle, type AnswerMemory, type HumanSession } from "./client/relay.ts";
export { eachLive, QUIET_DROP_MS, reason, type Live, type OpenKind, type PresenceFields, type StreamOptions } from "./client/live.ts";
export type { Probe } from "./client/wire.ts";
export { ownerStatement } from "./client/keys.ts";
export { INFO_MAX_AGE_MS, keepRecordsIn, type Info, type MemberRow, type RecordMemory } from "./client/info.ts";
export { keepBlobsIn, type BlobMemory } from "./client/images.ts";
export { keepHeld } from "./client/sealed.ts";
export type { RoomsSetting } from "./client/settings.ts";
export type { JoinStatus, JoinWatch } from "./client/join.ts";
export type { SendOptions } from "./client/send.ts";
export type { ChannelFx } from "./client/core.ts";
export type { GithubDiff, GithubIssueInfo, ReviewCheck } from "./client/github.ts";

export interface RoomPick {
  name: string;
  pk: string;
  xpk: string;
}

const withMe = (me: Identity, members: readonly RoomPick[]): RoomPick[] => (members.some((m) => m.pk === me.pk) || !me.xpk ? [...members] : [{ name: me.name, pk: me.pk, xpk: me.xpk }, ...members]);

const everySeat = (roster: readonly Member[], picked: readonly RoomPick[]): RoomPick[] =>
  withSeats(
    roster.flatMap((r) => (r.xpk && !r.unverified ? [{ ...r, xpk: r.xpk }] : [])),
    picked,
    (r) => ({ name: r.name, pk: r.pk, xpk: r.xpk }),
  );

const seatsOf = (roster: readonly Member[], me: string): Member[] => {
  const mine = roster.find((r) => r.pk === me);
  const person = mine ? personOf(mine, roster) : `seat:${me}`;
  return roster.filter((r) => r.pk === me || (isPerson(r) && personOf(r, roster) === person));
};
export class Channel {
  private readonly core: ChannelCore;
  private readonly cache: ChannelInfo;
  private readonly sending: ChannelSending;
  private readonly live: ChannelLive;
  private readonly makingDm = new Map<string, Promise<string>>();
  readonly fx: ChannelFx;

  constructor(access: ChannelAccess, relay: string, identity: Identity, onAccess?: (a: ChannelAccess) => void, opts: { keepInfo?: boolean; infoMaxAgeMs?: number; docStore?: DocStore | null } = {}) {
    this.core = new ChannelCore(access, relay, identity, onAccess);
    this.cache = new ChannelInfo(this.core, opts);
    const settings = new ChannelSettings(this.core, this.cache);
    const history = new ChannelHistory(this.core);
    const images = new ChannelImages(this.core, settings);
    const live = new ChannelLive(this.core, this.cache, opts.docStore ?? null);
    this.live = live;
    this.sending = new ChannelSending(this.core, live, settings, images);
    this.fx = {
      ...new ChannelKeys(this.core).fx,
      ...this.cache.fx,
      ...settings.fx,
      ...new ChannelRequests(this.core).fx,
      ...new ChannelMembers(this.core, this.cache).fx,
      ...new ChannelDelegations(this.core).fx,
      ...history.fx,
      ...new ChannelSnapshots(this.core, history).fx,
      ...this.sending.fx,
      ...images.fx,
      ...new ChannelFiles(this.core).fx,
      ...live.fx,
      ...new ChannelGithub(this.core).fx,
    };
    this.core.fx = this.fx;
  }

  get name(): string {
    return this.core.name;
  }

  get access(): ChannelAccess {
    return this.core.access;
  }

  set access(access: ChannelAccess) {
    this.core.access = access;
  }

  get relay(): string {
    return this.core.relay;
  }

  get identity(): Identity {
    return this.core.identity;
  }

  get onSent(): ((seq: number, message: Message | null) => void) | null {
    return this.sending.onSent;
  }

  set onSent(onSent: ((seq: number, message: Message | null) => void) | null) {
    this.sending.onSent = onSent;
  }

  forgetInfo(): void {
    this.cache.forgetInfo();
  }

  nudge(): void {
    this.live.nudge();
  }

  threadDoc(thread: string, th?: string): Promise<ThreadDoc> {
    return this.live.docs.open(thread, th);
  }

  closeDoc(thread: string): void {
    this.live.docs.close(thread);
  }

  async compactDoc(thread: string, th: string): Promise<boolean> {
    const had = this.live.docs.has(thread);
    const td = await this.live.docs.open(thread, th);
    try {
      return td.th === th && (await Promise.race([td.compactNow(), new Promise<boolean>((done) => setTimeout(() => done(false), COMPACT_WAIT_MS))]));
    } finally {
      if (!had) this.live.docs.close(thread);
    }
  }

  get roomId(): string {
    return this.core.roomId;
  }

  get isOwner(): boolean {
    return this.core.isOwner;
  }

  set opensRooms(on: boolean) {
    this.core.opensRooms = on;
  }

  static readonly fx = joinFx;

  // ---------- the same, as Promises ----------

  /**
   * Create a channel owned by `owner` (the human), with `agent` (the creating
   * agent) admitted alongside. Returns the join code and the owner's access.
   */
  static create(
    relay: string,
    owner: Identity,
    ownerInfo: MemberInfo,
    agents: (Identity & { info: MemberInfo })[] = [],
    roomId = newRoomId(),
    human?: string | null,
    /** A name for the channel; sealed, so only members can read it. */
    title?: string,
  ): Promise<{ code: string; access: ChannelAccess }> {
    return run(Channel.fx.create(relay, owner, ownerInfo, agents, roomId, human, title));
  }

  /**
   * Ask to join. Name and role are sealed to the owner, so the relay can't read
   * them. The request commits to this key's half of the code check (sas.ts);
   * the code itself appears in joinStatus once the owner has signed its half.
   * Asking again with the same key resumes the same request.
   */
  static requestJoin(
    relay: string,
    code: string,
    id: Identity,
    info: MemberInfo,
    /** The claims sealed into the request: an agent's computer claim, a person's person claim. */
    claims?: JoinClaims,
  ): Promise<{ roomId: string; requestId: string; ownerPk: string; computer: string | null }> {
    return run(Channel.fx.requestJoin(relay, code, id, info, claims));
  }

  /** Check a join request. Once approved, returns this member's access. */
  static joinStatus(relay: string, code: string, id: Identity, requestId: string): Promise<JoinStatus> {
    return run(Channel.fx.joinStatus(relay, code, id, requestId));
  }

  static watchJoin(relay: string, code: string, id: Identity, requestId: string, seen: string | null, waitSeconds: number): Promise<JoinWatch> {
    return run(Channel.fx.watchJoin(relay, code, id, requestId, seen, waitSeconds));
  }

  /**
   * This key's access to a channel it's already a member of (re-running join with
   * the same key, e.g. after the config was lost): nothing new is granted.
   * Throws a RelayError 403 when the key isn't a member.
   */
  static resume(relay: string, code: string, id: Identity): Promise<ChannelAccess> {
    return run(Channel.fx.resume(relay, code, id));
  }

  /** Fetch this member's wrapped keys (after a rotation) and unwrap them. */
  refreshKeys(): Promise<void> {
    return run(this.fx.refreshKeys());
  }

  /**
   * The channel's public info. `fp` is the join code's fingerprint half, proof we hold the code; by
   * default it's the known owner key's. A probe that doesn't know the owner yet passes the code's.
   * (A 404 here is never read as "closed": only member routes decide that, see gone().)
   */
  info(fp?: string): Promise<Info> {
    return run(this.fx.info(fp));
  }

  /**
   * The channel's name, if a member can trust it. A new room carries a separate
   * owner signature that titles are signed, so an unsigned blob is refused.
   * An older room, or a new one whose relay stripped that signature, still
   * shows a plain `{ name }` until this client has seen a title the owner
   * signed; after that, unsigned is refused too. A title sealed by a member
   * (they hold the channel key) never shows.
   */
  title(): Promise<string | null> {
    return run(this.fx.title());
  }

  /** Owner only: rename the channel. The new name is signed and sealed, like the icon. */
  setTitle(name: string): Promise<void> {
    return run(this.fx.setTitle(name));
  }

  /**
   * The rooms the owner last signed into the channel's settings, as they stood after log position
   * `since`: the floor for a client holding only the tail, where a room.create may have scrolled out.
   */
  rooms(): Promise<RoomsSetting | null> {
    return run(this.fx.rooms());
  }

  /** Owner: sign the room list into the channel's settings, as it stands after the room event at `since`. */
  setRooms(rooms: RoomsSetting): Promise<void> {
    return run(this.fx.setRooms(rooms));
  }

  guard(): Promise<GuardFloor | null> {
    return run(this.fx.guard());
  }

  setCharter(charter: NonNullable<GuardFloor["charter"]>): Promise<void> {
    return run(this.fx.setCharter(charter));
  }

  setHold(hold: NonNullable<GuardFloor["hold"]>): Promise<void> {
    return run(this.fx.setHold(hold));
  }

  setRepos(repos: NonNullable<GuardFloor["repos"]>): Promise<void> {
    return run(this.fx.setRepos(repos));
  }

  compress(): Promise<boolean> {
    return run(this.fx.compress());
  }

  setCompress(on: boolean): Promise<void> {
    return run(this.fx.setCompress(on));
  }

  /** The channel's icon, if the owner set one (only members can read it). */
  icon(): Promise<ChannelIcon | null> {
    return run(this.fx.icon());
  }

  /** Owner only: set the channel's icon (null clears it), signed by the owner and sealed with the current channel key. */
  setIcon(icon: ChannelIcon | null): Promise<void> {
    return run(this.fx.setIcon(icon));
  }

  /** The verified member list. Records that fail verification are dropped. */
  members(): Promise<Member[]> {
    return run(this.fx.members());
  }

  memberRows(): Promise<MemberRow[]> {
    return run(this.fx.memberRows());
  }

  /** Leave the channel. Access is revoked at once; the owner rotates the key. */
  leave(): Promise<void> {
    return run(this.fx.leave());
  }

  /**
   * Pending join requests, opened (only the owner can read their names). With a
   * budget, this device signs the owner's half of each new request's code check
   * on its own, up to its day's share (sas.ts); past that, checkRequest() does
   * it for one request at a person's click. With the owner's person key, own
   * computers' requests are marked as such (for autoApprove).
   */
  requests(opts: RequestsOptions = {}): Promise<JoinRequest[]> {
    return run(this.fx.requests(opts));
  }

  /** Sign the owner's half of one request's code check: a person's explicit go, outside the budget. */
  checkRequest(req: Pick<JoinRequest, "id" | "pk" | "commit">): Promise<void> {
    return run(this.fx.checkRequest(req));
  }

  /** Admit a requester: sign its record, and wrap every epoch key to it. */
  approve(req: JoinRequest, as?: Partial<MemberInfo>, opts?: { person?: string }): Promise<Member> {
    return run(this.fx.approve(req, as, opts));
  }

  pinPersona(p: Personality): Promise<string> {
    return run(this.fx.pinPersona(p));
  }

  /**
   * The app's background approval: given the owner's person key, approve every request from the
   * owner's own computers whose code is ready, as agents sponsored by the owner, without spending
   * the daily signing budget. Returns who was let in.
   */
  autoApprove(person: string, personalities: readonly Personality[] = [], mine: readonly string[] | null = null, lists?: ReadonlyMap<string, DeviceList>): Promise<Member[]> {
    return run(this.fx.autoApprove(person, personalities, mine, lists));
  }

  deny(requestId: string): Promise<void> {
    return run(this.fx.deny(requestId));
  }

  delegate(device: { pk: string; xpk: string }, person: string): Promise<Delegation> {
    return run(this.fx.delegate(device, person));
  }

  undelegate(pk: string): Promise<void> {
    return run(this.fx.undelegate(pk));
  }

  delegations(): Promise<Delegation[]> {
    return run(this.fx.delegations());
  }

  tendDelegations(computers: readonly Computer[], person: string): Promise<Tended> {
    return run(this.fx.tendDelegations(computers, person));
  }

  dropDelegates(pks: readonly string[]): Promise<string[]> {
    return run(this.fx.dropDelegates(pks));
  }

  /** Whether a member may post: the one bit of their scopes the relay enforces (the scope.set event is the record). */
  setCanPost(pk: string, post: boolean): Promise<void> {
    return run(this.fx.setCanPost(pk, post));
  }

  /**
   * Owner: after a scope.set at log position `since`, re-sign the member's record to say so (a client
   * that loads only the tail of the log learns it there) and set the relay's "can post" bit, in one
   * request. The record keeps what it said at approval; `later` is what holds from `since` on.
   */
  updateScopes(m: Member, scopes: readonly Scope[], since: number): Promise<void> {
    return run(this.fx.updateScopes(m, scopes, since));
  }

  updatePersona(m: Member, persona: Persona | null, since: number): Promise<void> {
    return run(this.fx.updatePersona(m, persona, since));
  }

  updateNickname(m: Member, nickname: string | null): Promise<void> {
    return run(this.fx.updateNickname(m, nickname));
  }

  updatePowers(m: Member, powers: PersonPowers): Promise<void> {
    return run(this.fx.updatePowers(m, powers));
  }

  /**
   * Owner: make each member's record and the relay's "can post" bit match the log. A scope.set lands
   * first and the record (with the bit) follows in a second call; if that one failed, or the bit was
   * changed some other way, this puts it right. Returns the keys it changed.
   */
  reconcilePosting(state: Reconciled, members?: Member[]): Promise<string[]> {
    return run(this.fx.reconcilePosting(state, members));
  }

  /** Remove a member and rotate the key so they can't read anything newer. */
  remove(pk: string): Promise<void> {
    return run(this.fx.remove(pk));
  }

  cutDevices(list: DeviceList, keeps?: Keeps): Promise<Member[]> {
    return run(this.fx.cutDevices(list, keeps));
  }

  goneDevices(list: DeviceList, keeps?: Keeps): Promise<Member[]> {
    return run(this.fx.goneDevices(list, keeps));
  }

  /** New channel key, wrapped to every remaining member. */
  rotate(): Promise<number> {
    return run(this.fx.rotate());
  }

  /** Rotate if a member left since the last rotation. */
  rotateIfDue(): Promise<boolean> {
    return run(this.fx.rotateIfDue());
  }

  snapshotIfDue(): Promise<number | null> {
    return run(this.fx.snapshotIfDue());
  }

  setGithubRepos(repos: string[], token: string | null = null): Promise<string[]> {
    return run(this.fx.setGithubRepos(repos, token));
  }

  drainGithub(): Promise<number> {
    return run(this.fx.drainGithub());
  }

  syncGithubRules(repos: readonly string[], known: readonly GithubRules[]): Promise<number> {
    return run(this.fx.syncGithubRules(repos, known));
  }

  syncGithubReleases(repos: readonly string[], known: readonly GithubRelease[]): Promise<number> {
    return run(this.fx.syncGithubReleases(repos, known));
  }

  syncGithub(repo: string, known: GithubState): Promise<number> {
    return run(this.fx.syncGithub(repo, known));
  }

  githubStatus(): Promise<GithubStatus> {
    return run(this.fx.githubStatus());
  }

  githubDiff(repo: string, sha: string): Promise<GithubDiff> {
    return run(this.fx.githubDiff(repo, sha));
  }

  postReviewCheck(c: ReviewCheck): Promise<{ url: string | null }> {
    return run(this.fx.postReviewCheck(c));
  }

  commentOnPr(repo: string, number: number, body: string): Promise<{ url: string | null }> {
    return run(this.fx.commentOnPr(repo, number, body));
  }

  githubIssue(repo: string, number: number): Promise<GithubIssueInfo> {
    return run(this.fx.githubIssue(repo, number));
  }

  closeIssue(c: { repo: string; number: number; reason: "completed" | "not_planned"; body: string }): Promise<{ url: string | null }> {
    return run(this.fx.closeIssue(c));
  }

  private async roomSeats(picked: readonly RoomPick[]): Promise<RoomMember[]> {
    return everySeat(await this.members(), withMe(this.core.identity, picked)).map(({ name, pk }) => ({ name, pk }));
  }

  private async openRoom(say: string, name: string, members: RoomMember[], kind: { dm?: true; self?: true }): Promise<string> {
    const id = newRoomId();
    const seq = await this.send(say, { kind: "event", ev: { op: "room.create", id, name: kind.dm || kind.self ? "" : name, members, ...kind } });
    this.core.memberRooms.set(id, { members, ...kind, seq });
    return id;
  }

  async makeRoom(name: string, members: readonly RoomPick[]): Promise<string> {
    return this.openRoom("made a members-only room", name, await this.roomSeats(members), {});
  }

  makeDm(other: RoomPick): Promise<string> {
    const making = this.makingDm.get(other.pk) ?? this.dmWith(other).finally(() => this.makingDm.delete(other.pk));
    this.makingDm.set(other.pk, making);
    return making;
  }

  private async dmWith(other: RoomPick): Promise<string> {
    const members = await this.roomSeats([other]);
    const ours = new Set(members.map((m) => m.pk));
    const me = this.core.identity.pk;
    const sealed = [...this.core.roomNow].flatMap(([id, r]) => (r.meta ? [[id, r.meta] as const] : []));
    const had = [...this.core.memberRooms, ...sealed].find(([, r]) => r.dm && r.members.some((m) => m.pk === me) && r.members.some((m) => m.pk === other.pk) && r.members.every((m) => ours.has(m.pk)));
    return had?.[0] ?? this.openRoom("started a direct conversation", "", members, { dm: true });
  }

  async makeSelf(): Promise<string> {
    return this.openRoom("keeps their own notes", "", await this.roomSeats([]), { self: true });
  }

  async syncMarks(local: Marks, opts: { write?: boolean; make?: boolean } = {}): Promise<Marks | null> {
    const write = opts.write ?? true;
    const me = this.core.identity.pk;
    const sealed = [...this.core.roomNow].find(([, r]) => r.key && r.meta?.self && r.meta.members.some((m) => m.pk === me));
    const seats = sealed ? [] : seatsOf(await this.members(), me);
    const person = new Set([me, ...seats.map((r) => r.pk)]);
    const own = () => [...this.core.memberRooms].filter(([, r]) => r.self && r.members.length > 0 && r.members.every((m) => person.has(m.pk))).sort(([, a], [, b]) => (a.seq ?? 0) - (b.seq ?? 0))[0];
    if (!sealed && !own() && write && (opts.make ?? true)) await this.makeSelf();
    const plain = sealed ? undefined : own();
    const listed = plain?.[1].members.some((m) => m.pk === me);
    const unlisted = seats.some((r) => r.active && r.xpk && !r.unverified && !plain?.[1].members.some((m) => m.pk === r.pk));
    if (plain && write && listed && unlisted && this.core.identity.xpk) await this.changeRoom(plain[0], { members: [] });
    const [roomId, room] = sealed ?? [];
    const epoch = this.core.access.epoch;
    const key = room?.key ?? (plain ? this.core.access.keys[String(epoch)] : undefined);
    const members = room?.meta?.members ?? plain?.[1].members;
    if (!key || !members) return null;
    const { mergeMarks, noteId, openNote, sealNote } = await import("./note.ts");
    const mine = new Set([...members.map((m) => m.pk), ...seats.filter((r) => r.active).map((r) => r.pk)]);
    const scope = plain ? `${this.roomId}/${plain[0]}` : this.roomId;
    const id = await noteId(scope, key);
    const prevKey = room ? (room.meta?.prev ?? this.core.roomKeys.get(`${roomId}/${room.n - 1}`)) : this.core.access.keys[String(epoch - 1)];
    for (let tries = 0; tries < 5; tries++) {
      const had = await run(this.fx.getNote(id));
      let theirs: Marks = {};
      if (had) {
        const opened = await openNote(key, this.roomId, id, had.box);
        if (opened && mine.has(opened.pk)) theirs = opened.marks;
      } else if (prevKey) {
        const prev = prevKey;
        const oldId = await noteId(scope, prev);
        const old = await run(this.fx.getNote(oldId));
        const opened = old ? await openNote(prev, this.roomId, oldId, old.box) : null;
        if (opened) theirs = opened.marks;
      }
      const merged = mergeMarks(theirs, local);
      const moved = Object.entries(merged).some(([k, v]) => (theirs[k] ?? -1) !== v);
      if (!write || (had && !moved)) return merged;
      const put = await run(this.fx.putNote(id, await sealNote(key, this.roomId, id, this.core.identity, merged), had?.version ?? null));
      if (!put.conflict) return merged;
    }
    return null;
  }

  async changeRoom(id: string, change: { name?: string; members?: readonly RoomPick[] }): Promise<boolean> {
    const now =
      this.core.memberRooms.get(id) ??
      (() => {
        const sealed = this.core.roomNow.get(id)?.meta;
        return sealed ? { members: sealed.members, ...(sealed.dm ? { dm: true as const } : {}), ...(sealed.self ? { self: true as const } : {}) } : undefined;
      })();
    if (!now) throw new Error("you're not in that members-only room");
    let changed = false;
    if (change.name) {
      await this.send("renamed a room", { kind: "event", ev: { op: "room.rename", id, name: change.name } });
      changed = true;
    }
    if (change.members) {
      const roster = await this.members();
      const here = new Set(roster.filter((r) => r.active).map((r) => r.pk));
      const members = everySeat(roster, withMe(this.core.identity, change.members))
        .filter((w) => here.has(w.pk) || w.pk === this.core.identity.pk)
        .map(({ name, pk }) => ({ name, pk }));
      const same = members.length === now.members.length && members.every((m) => now.members.some((x) => x.pk === m.pk));
      if (!same) {
        const name = this.core.roomNow.get(id)?.meta?.name ?? "";
        const kind = { ...(now.dm ? { dm: true as const } : {}), ...(now.self ? { self: true as const } : {}) };
        await this.send("changed who a room is for", { kind: "event", ev: { op: "room.members", id, name: kind.dm || kind.self ? "" : name, members, ...kind } });
        const seq = this.core.memberRooms.get(id)?.seq;
        this.core.memberRooms.set(id, { members, ...kind, ...(seq === undefined ? {} : { seq }) });
        changed = true;
      }
    }
    return changed;
  }

  async sentRooms(): Promise<string[]> {
    const seats = new Map((await this.members()).map((r) => [r.name, r]));
    const rooms = new Map<string, { members?: readonly { name: string; pk: string }[] }>([...this.core.publicRooms].map((id) => [id, {}]));
    for (const [id, r] of this.core.memberRooms) rooms.set(id, r);
    for (const [id, now] of this.core.roomNow) if (now.meta && !rooms.has(id)) rooms.set(id, now.meta);
    return [GENERAL_ROOM, ...[...rooms].filter(([, r]) => sentTo(r, this.core.name, seats)).map(([id]) => id)];
  }

  async leaveRoom(id: string): Promise<number> {
    if (!this.core.memberRooms.has(id) && !this.core.roomNow.get(id)?.meta) throw new Error("you're not in that members-only room");
    const seq = await this.send("left the room", { kind: "event", ev: { op: "room.leave", id } });
    this.core.memberRooms.delete(id);
    return seq;
  }

  async learnRooms<T extends { seq: number }>(rows: readonly (T | Message | null)[]): Promise<(T | Message | null)[]> {
    const isMessage = (m: T | Message | null): m is Message => !!m && "ev" in m && !!(m as Message).ev;
    const settled = new Map<number, Message>();
    for (const m of rows.filter(isMessage).sort((a, b) => a.seq - b.seq))
      if (m.ev?.op === "room.seal") settled.set(m.seq, await run(this.fx.settle(m)));
      else this.core.learnRoom(m);
    return Promise.all(
      rows.map(async (m) => {
        if (!isMessage(m)) return m;
        if (m.ev?.op === "room.seal") return settled.get(m.seq) ?? m;
        if (m.ev?.op === "room.msg") return (await run(this.fx.unseal(m))) ?? m;
        return m;
      }),
    );
  }

  openRooms(base: FoldBase): Promise<FoldBase> {
    return run(this.fx.openRooms(base));
  }

  snapshot(): Promise<FoldBase | null> {
    return run(this.fx.snapshot());
  }

  page(since: number, limit: number): Promise<Message[]> {
    return run(this.fx.page(since, limit));
  }

  envelopes(since: number, limit: number): Promise<{ head: number; messages: Envelope[] }> {
    return run(this.fx.envelopes(since, limit));
  }

  docList(): Promise<DocStat[]> {
    return run(this.fx.docList());
  }

  pruneDocs(th: readonly string[]): Promise<DocsPruned> {
    return run(this.fx.pruneDocs(th));
  }

  snapshotAt(): Promise<number | null> {
    return run(this.fx.snapshotAt());
  }

  /** Delete the channel at the relay: messages, members, keys, everything. */
  close(): Promise<void> {
    return run(this.fx.close());
  }

  head(): Promise<number> {
    return run(this.fx.head());
  }

  send(body: string, opts: SendOptions = {}): Promise<number> {
    return run(this.fx.send(body, opts));
  }

  imageRefs(): Promise<boolean> {
    return run(this.fx.imageRefs());
  }

  setImageRefs(on: boolean): Promise<void> {
    return run(this.fx.setImageRefs(on));
  }

  image(img: ImageAttachment): Promise<string | null> {
    return run(this.fx.image(img));
  }

  putImage(img: InlineImage): Promise<ImageAttachment> {
    return run(this.fx.putImage(img));
  }

  putFileData(name: string, mime: string, data: string): Promise<FileAttachment> {
    return run(this.fx.putFile(name, mime, fromBase64(data)));
  }

  async fileData(f: FileAttachment): Promise<string | null> {
    const bytes = await run(this.fx.file(f));
    return bytes ? toBase64(bytes) : null;
  }

  putFile(name: string, mime: string, bytes: Uint8Array<ArrayBuffer>): Promise<FileAttachment> {
    return run(this.fx.putFile(name, mime, bytes));
  }

  file(f: FileAttachment): Promise<Uint8Array<ArrayBuffer> | null> {
    return run(this.fx.file(f));
  }

  decrypt(env: Envelope): Promise<Message | null> {
    return run(this.fx.decrypt(env));
  }

  /** Messages after `since`, oldest first, following pages to the head. */
  history(since: number): Promise<{ head: number; messages: Message[]; first: number | null }> {
    return run(this.fx.history(since));
  }

  /**
   * Stream messages after `since` until `signal` aborts. Replays anything
   * missed, reconnects with backoff, and resumes from the last delivered seq,
   * so nothing is lost across drops. `onMessage` runs strictly in order.
   * Throws ChannelGone if this member is removed or the channel is closed.
   */
  stream(since: number, onMessage: (m: Message) => void | Promise<void>, opts: StreamOptions = {}): Promise<void> {
    return runUntil(this.fx.stream(since, onMessage, opts), opts.signal);
  }
}

/** Whether a message is addressed to `agent` (directly, or as a broadcast). */
export function isForAgent(m: Message, agent: string): boolean {
  return !m.to || m.to.includes(agent) || m.to.includes("*");
}

/** Addressed to `agent` by name (not a broadcast). */
export function isDirectedAt(m: Message, agent: string): boolean {
  return !!m.to?.includes(agent);
}
