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
import { newRoomId, type ChannelAccess } from "./crypto.ts";
import type { Identity } from "./identity.ts";
import type { JoinClaims, JoinRequest, Member, MemberInfo, PersonPowers } from "./membership.ts";
import { withSeats } from "./room-rules.ts";
import type { Marks } from "./note.ts";
import type { ChannelIcon, Envelope, ImageAttachment, Message } from "./protocol.ts";
import type { Scope } from "./scopes.ts";
import type { ChannelState, FoldBase, GithubRelease, GithubRules, GuardFloor } from "./state.ts";
import { ChannelCore, type ChannelFx } from "./client/core.ts";
import { ChannelDelegations, type Computer, type Tended } from "./client/delegations.ts";
import { ChannelGithub, type GithubDiff, type GithubIssueInfo, type ReviewCheck } from "./client/github.ts";
import { ChannelHistory } from "./client/history.ts";
import { ChannelImages } from "./client/images.ts";
import { ChannelInfo, type Info, type MemberRow } from "./client/info.ts";
import { joinFx, type JoinStatus } from "./client/join.ts";
import { ChannelKeys } from "./client/keys.ts";
import { ChannelLive, type StreamOptions } from "./client/live.ts";
import { ChannelMembers } from "./client/members.ts";
import { run, runUntil } from "./client/relay.ts";
import { ChannelRequests, type RequestsOptions } from "./client/requests.ts";
import type { Delegation } from "./delegation.ts";
import type { DeviceList } from "./devices.ts";
import { ChannelSending, type SendOptions } from "./client/send.ts";
import { ChannelSettings, type RoomsSetting } from "./client/settings.ts";
import { ChannelSnapshots } from "./client/snapshots.ts";

export { ChannelGone, goneText, RelayError, Unreachable, type Refused } from "./client/errors.ts";
export { downWhy, fetchRelay, keepAnswersIn, OfflineReads, Relay, relayConfig, relayDown, settle, type AnswerMemory, type HumanSession } from "./client/relay.ts";
export { eachLive, QUIET_DROP_MS, reason, type Live, type OpenKind, type PresenceFields, type StreamOptions } from "./client/live.ts";
export type { Probe } from "./client/wire.ts";
export { ownerStatement } from "./client/keys.ts";
export { INFO_MAX_AGE_MS, keepRecordsIn, type Info, type MemberRow, type RecordMemory } from "./client/info.ts";
export { keepBlobsIn, type BlobMemory } from "./client/images.ts";
export { keepHeld } from "./client/sealed.ts";
export type { RoomsSetting } from "./client/settings.ts";
export type { JoinStatus } from "./client/join.ts";
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
export class Channel {
  private readonly core: ChannelCore;
  private readonly cache: ChannelInfo;
  private readonly sending: ChannelSending;
  private readonly live: ChannelLive;
  readonly fx: ChannelFx;

  constructor(access: ChannelAccess, relay: string, identity: Identity, onAccess?: (a: ChannelAccess) => void, opts: { keepInfo?: boolean; infoMaxAgeMs?: number } = {}) {
    this.core = new ChannelCore(access, relay, identity, onAccess);
    this.cache = new ChannelInfo(this.core, opts);
    const settings = new ChannelSettings(this.core, this.cache);
    const history = new ChannelHistory(this.core);
    const images = new ChannelImages(this.core, settings);
    const live = new ChannelLive(this.core, this.cache);
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
  reconcilePosting(state: Pick<ChannelState, "members" | "scopeSets" | "roleSets">, members?: Member[]): Promise<string[]> {
    return run(this.fx.reconcilePosting(state, members));
  }

  /** Remove a member and rotate the key so they can't read anything newer. */
  remove(pk: string): Promise<void> {
    return run(this.fx.remove(pk));
  }

  cutDevices(list: DeviceList): Promise<Member[]> {
    return run(this.fx.cutDevices(list));
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

  async makeRoom(name: string, members: readonly RoomPick[]): Promise<string> {
    const { newRoomKey, sealRoom } = await import("./private-room.ts");
    const id = newRoomId();
    const who = everySeat(await this.members(), withMe(this.core.identity, members));
    const key = newRoomKey();
    const meta = { name, members: who.map(({ name, pk }) => ({ name, pk })) };
    const sealed = await sealRoom(
      this.roomId,
      id,
      1,
      key,
      meta,
      who.map((w) => w.xpk),
    );
    (await import("./private-room.ts")).ownSeal(this.core, id, await this.send("made a private room", { kind: "event", ev: { op: "room.seal", ...sealed } }), sealed, { n: 1, key, meta });
    return id;
  }

  async makeDm(other: RoomPick): Promise<string> {
    const { newRoomKey, sealRoom } = await import("./private-room.ts");
    const id = newRoomId();
    const who = everySeat(await this.members(), withMe(this.core.identity, [other]));
    const key = newRoomKey();
    const meta = { name: "", members: who.map(({ name, pk }) => ({ name, pk })), dm: true as const };
    const sealed = await sealRoom(
      this.roomId,
      id,
      1,
      key,
      meta,
      who.map((w) => w.xpk),
    );
    (await import("./private-room.ts")).ownSeal(this.core, id, await this.send("started a private conversation", { kind: "event", ev: { op: "room.seal", ...sealed } }), sealed, { n: 1, key, meta });
    return id;
  }

  async makeSelf(): Promise<string> {
    const { newRoomKey, sealRoom } = await import("./private-room.ts");
    const id = newRoomId();
    const who = everySeat(await this.members(), withMe(this.core.identity, []));
    const key = newRoomKey();
    const meta = { name: "", members: who.map(({ name, pk }) => ({ name, pk })), self: true as const };
    const sealed = await sealRoom(
      this.roomId,
      id,
      1,
      key,
      meta,
      who.map((w) => w.xpk),
    );
    (await import("./private-room.ts")).ownSeal(this.core, id, await this.send("keeps a private note", { kind: "event", ev: { op: "room.seal", ...sealed } }), sealed, { n: 1, key, meta });
    return id;
  }

  async syncMarks(local: Marks, opts: { write?: boolean } = {}): Promise<Marks | null> {
    const write = opts.write ?? true;
    const own = () => [...this.core.roomNow].find(([, r]) => r.key && r.meta?.self && r.meta.members.some((m) => m.pk === this.core.identity.pk));
    let found = own();
    if (!found && write) {
      await this.makeSelf();
      found = own();
    }
    const [roomId, room] = found ?? [];
    if (!roomId || !room?.key || !room.meta) return null;
    const { mergeMarks, noteId, openNote, sealNote } = await import("./note.ts");
    const key = room.key;
    const mine = new Set(room.meta.members.map((m) => m.pk));
    const id = await noteId(this.roomId, key);
    const prevKey = room.meta.prev ?? this.core.roomKeys.get(`${roomId}/${room.n - 1}`);
    for (let tries = 0; tries < 5; tries++) {
      const had = await run(this.fx.getNote(id));
      let theirs: Marks = {};
      if (had) {
        const opened = await openNote(key, this.roomId, id, had.box);
        if (opened && mine.has(opened.pk)) theirs = opened.marks;
      } else if (prevKey) {
        const prev = prevKey;
        const oldId = await noteId(this.roomId, prev);
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
    const now = this.core.roomNow.get(id);
    if (!now?.key || !now.meta) throw new Error("you're not in that private room");
    const last = this.core.roomSeals.get(id)?.at(-1)?.seal;
    if (change.name && !change.members && last?.n === now.n) {
      const { renameRoom } = await import("./private-room.ts");
      const meta = { ...now.meta, name: change.name };
      const sealed = await renameRoom(this.roomId, last, now.key, meta);
      (await import("./private-room.ts")).ownSeal(this.core, id, await this.send("changed a private room", { kind: "event", ev: { op: "room.seal", ...sealed } }), sealed, {
        n: now.n,
        key: now.key,
        meta,
      });
      return true;
    }
    const roster = await this.members();
    const here = new Map(roster.filter((r) => r.active).map((r) => [r.pk, r]));
    const asked = change.members ? withMe(this.core.identity, change.members) : null;
    const who = everySeat(
      roster,
      (asked ?? now.meta.members.flatMap((m) => (here.has(m.pk) ? [{ name: m.name, pk: m.pk, xpk: here.get(m.pk)!.xpk }] : []))).filter((w) => here.has(w.pk) || w.pk === this.core.identity.pk),
    );
    const out = now.meta.members.some((m) => !who.some((w) => w.pk === m.pk));
    if (!out && !change.name && who.length === now.meta.members.length) return false;
    const { newRoomKey, sealRoom } = await import("./private-room.ts");
    const n = out ? now.n + 1 : now.n;
    const key = out ? newRoomKey() : now.key;
    const meta = {
      name: change.name ?? now.meta.name,
      members: who.map(({ name, pk }) => ({ name, pk })),
      ...(now.meta.dm ? { dm: true as const } : {}),
      ...(now.meta.self ? { self: true as const } : {}),
    };
    const sealed = await sealRoom(
      this.roomId,
      id,
      n,
      key,
      meta,
      who.map((w) => w.xpk),
      now.key,
    );
    (await import("./private-room.ts")).ownSeal(this.core, id, await this.send("changed a private room", { kind: "event", ev: { op: "room.seal", ...sealed } }), sealed, { n, key, meta });
    return true;
  }

  async pruneRooms(only?: readonly string[]): Promise<string[]> {
    const pruned: string[] = [];
    for (const [id, now] of this.core.roomNow) if ((!only || only.includes(id)) && now.key && now.meta && (await this.changeRoom(id, {}))) pruned.push(id);
    return pruned;
  }

  async learnRooms(messages: readonly Message[]): Promise<void> {
    for (const m of [...messages].sort((a, b) => a.seq - b.seq)) if (m.ev?.op === "room.seal") await run(this.fx.settle(m));
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
