// An agent's view of one channel: the operations behind every CLI command
// and MCP tool. Keeps a local cache of the decrypted log so folding shared
// state (tasks, claims, facts, members) costs one incremental fetch.

import { Channel, ChannelGone, isDirectedAt, isForAgent, keepRecordsIn, QUIET_DROP_MS, RelayError, type SendOptions } from "./client.ts";
import { appendCache, fileRecordMemory, loadIdentity, markSeen, readCache, readCursor, readSeen, saveAccess, signingBudget, writeCursor, type ChannelConfig } from "./config.ts";
import { TOO_MANY_REQUESTS } from "./sas.ts";
import type { ChannelAccess } from "./crypto.ts";
import { inlineText, type JoinRequest } from "./membership.ts";
import type { Identity } from "./identity.ts";
import { canPost, describeScopes, refusal, wireScopes, type Scope } from "./scopes.ts";
import { GENERAL_ROOM, ignored, MAX_CHARTER, TASK_STATES, type Card, type Color, type Event, type Handoff, type ImageAttachment, type Kind, type Message, type Presence, type TaskState } from "./protocol.ts";
import { allowedOnHold, claimConflict, findRoom, fold, humanOf, isPerson, keptFromPeople, newRoomId, normTags, ON_HOLD, overlaps, ownerOf, taskId, waitingOn, wouldCycle, type ChannelState, type GuardFloor, type Roster, type RoomsFloor } from "./state.ts";
import { mergeCard, sameCard } from "./card.ts";
import { cardLine } from "./format.ts";

/** How often a listening agent re-announces itself. Receivers treat 2.5x this as offline. */
export const PRESENCE_EVERY_MS = 60_000;
/** What `--to` takes for "everyone, on purpose". */
const EVERYONE = new Set(["all", "everyone", "*"]);
export const PRESENCE_TTL_MS = 150_000;

export interface Delivery {
  /** Show every message, including all coordination events. */
  all?: boolean;
  /** Every chat message, whoever it's for (what a coordinator wants). */
  chat?: boolean;
  /** Only messages addressed to this agent (by name or role, or broadcast asks). */
  forMe?: boolean;
  /** Only messages in the thread this message (root or reply) is in. */
  thread?: number;
  /** Only chat in this room (an id); events, which are channel-wide, still arrive as usual. Default: every room. */
  room?: string;
}

export class Rejected extends Error {}

export class AgentSession {
  readonly ch: Channel;
  /** The owner's channel handle, when this machine holds the owner key. */
  readonly ownerCh: Channel | null;
  private roster: Roster | null = null;

  private constructor(
    readonly alias: string,
    readonly cfg: ChannelConfig,
    readonly identity: Identity,
    owner: Identity | null,
  ) {
    const persist = (a: ChannelAccess) => saveAccess(alias, a);
    this.ch = new Channel(cfg, cfg.relay, identity, persist);
    this.ownerCh = owner ? new Channel(cfg, cfg.relay, owner, persist) : null;
  }

  static async open(alias: string, cfg: ChannelConfig, name: string): Promise<AgentSession> {
    // Member records: the newest this machine has seen per key wins, across runs.
    keepRecordsIn(fileRecordMemory);
    const owner = cfg.owner ? await loadIdentity(cfg.owner, cfg.roomId) : null;
    return new AgentSession(alias, cfg, await loadIdentity(name, cfg.roomId), owner);
  }

  /** The verified member list (owner-signed records). */
  async members(refresh = false): Promise<Roster> {
    if (!this.roster || refresh) {
      this.roster = (await this.ch.members()).map((m) => ({
        name: m.name,
        pk: m.pk,
        role: m.role,
        about: m.about,
        owner: m.owner,
        at: m.at,
        active: m.active,
        kind: m.kind,
        display: m.display,
        sponsor: m.sponsor,
        color: m.color,
        ...(m.scopes ? { scopes: m.scopes } : {}),
        ...(m.later ? { later: m.later } : {}),
        ...(m.laterRole ? { laterRole: m.laterRole } : {}),
      }));
    }
    return this.roster;
  }

  /** Owner duty: rotate the channel key if someone left since the last rotation. */
  async ownerChores(): Promise<void> {
    if (!this.ownerCh) return;
    if (await this.ownerCh.rotateIfDue()) await this.ch.refreshKeys();
    // The relay's "can post" bit follows the log's scopes: check once a session, and again whenever
    // the roster changes or a scope.set's second step failed. (Not state(): it calls this.)
    if (this.postingChecked) return;
    const [messages, roster] = await Promise.all([this.sync(), this.members()]);
    await this.ownerCh.reconcilePosting(fold(messages, roster));
    this.postingChecked = true;
  }
  /** Whether the relay's can-post bits were checked against the log since the roster last changed. */
  private postingChecked = false;

  /** Pending join requests (owner machine only). */
  async requests(): Promise<JoinRequest[]> {
    if (!this.ownerCh) throw new Rejected("only the channel owner's machine can see join requests");
    return this.ownerCh.requests({ budget: signingBudget });
  }

  get me(): string {
    return this.identity.name;
  }

  // ---------- log & state ----------

  /** The full log: cached messages plus anything new from the relay. */
  async sync(): Promise<Message[]> {
    const cached = readCache(this.cfg.roomId);
    const last = cached.at(-1)?.seq ?? 0;
    const { messages } = await this.ch.history(last);
    const fresh = messages.filter((m) => m.seq > last);
    appendCache(this.cfg.roomId, fresh);
    return [...cached, ...fresh];
  }

  async state(): Promise<{ messages: Message[]; state: ChannelState }> {
    // On the owner's machine, any command finishes a rotation owed to a member leaving.
    await this.ownerChores();
    const [messages, roster] = await Promise.all([this.sync(), this.members()]);
    return { messages, state: await this.foldState(messages, roster) };
  }

  /**
   * Fold with the room list the owner signed into the settings: the relay keeps only so many
   * messages, so a room's create may be gone from the log. A message in a room we don't know,
   * newer than our last look, sends us to check that list again (it may have just been made).
   */
  private async foldState(messages: Message[], roster: Roster): Promise<ChannelState> {
    this.roomsFloor ??= await this.ch.rooms().catch(() => null);
    this.guardFloor ??= await this.ch.guard().catch(() => null);
    let state = fold(messages, roster, Date.now(), undefined, this.roomsFloor, this.guardFloor);
    const unknown = [...state.rejected].some(([seq, why]) => seq > this.roomsCheckedAt && why.startsWith("no room "));
    if (unknown) {
      this.roomsCheckedAt = state.head;
      this.roomsFloor = await this.ch.rooms().catch(() => null);
      state = fold(messages, roster, Date.now(), undefined, this.roomsFloor, this.guardFloor);
    }
    return state;
  }
  private roomsFloor: RoomsFloor | null | undefined;
  private guardFloor: GuardFloor | null | undefined;
  private roomsCheckedAt = 0;

  /** A room's id from its name or id (# optional); general when none is given. */
  async roomId(nameOrId: string | undefined, state?: ChannelState): Promise<string> {
    if (!nameOrId) return GENERAL_ROOM;
    const s = state ?? (await this.state()).state;
    const room = findRoom(s, nameOrId);
    if (!room) throw new Rejected(`no room ${nameOrId}: kiwi rooms lists them`);
    return room.id;
  }

  /** Owner: make a room. Its id is made here and never changes; the name can (renameRoom). */
  async createRoom(name: string): Promise<{ id: string; state: ChannelState }> {
    if (!this.ownerCh) throw new Rejected("only the channel owner's machine makes rooms");
    const id = newRoomId();
    const state = await this.roomEvent({ op: "room.create", id, name }, `made the room #${name}`);
    return { id, state };
  }

  /** Owner: rename a room (general too; ids stay). */
  async renameRoom(nameOrId: string, name: string): Promise<ChannelState> {
    if (!this.ownerCh) throw new Rejected("only the channel owner's machine names rooms");
    const id = await this.roomId(nameOrId);
    return this.roomEvent({ op: "room.rename", id, name }, `renamed a room to #${name}`);
  }

  /** Send a room event as the owner, confirm it, then sign the room list into the settings as of it. */
  private async roomEvent(ev: Event, body: string): Promise<ChannelState> {
    const seq = await this.ownerCh!.send(body, { kind: "event", ev });
    const state = await this.confirm(seq);
    const list = [...state.rooms.values()].filter((r) => r.id !== GENERAL_ROOM || r.name !== GENERAL_ROOM).map(({ id, name }) => ({ id, name }));
    await this.ownerCh!.setRooms({ list, since: seq });
    this.roomsFloor = { list, since: seq };
    return state;
  }

  /** The agent's read cursor, starting at the channel head the first time. */
  async cursor(): Promise<number> {
    const c = readCursor(this.alias, this.me);
    if (c !== null) return c;
    const head = await this.ch.head();
    writeCursor(this.alias, this.me, head);
    return head;
  }

  /**
   * Whether tail/wait/read should surface `m` to this agent. Chat is shown
   * (or only chat addressed to us, with forMe); coordination events only when
   * they concern us, plus members joining. Our own messages never are.
   */
  wants(m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
    return wants(this.me, m, state, d);
  }

  /** Unread messages for this agent; advances the cursor. */
  async read(d: Delivery = {}): Promise<{ messages: Message[]; state: ChannelState }> {
    const since = await this.cursor();
    const { messages, state } = await this.state();
    const seen = readSeen(this.alias, this.me);
    const unread = messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state, d));
    writeCursor(this.alias, this.me, Math.max(since, state.head));
    return { messages: unread, state };
  }

  async unreadCount(state: ChannelState, messages: Message[]): Promise<number> {
    const since = readCursor(this.alias, this.me) ?? state.head;
    const seen = readSeen(this.alias, this.me);
    return messages.filter((m) => m.seq > since && !seen.has(m.seq) && this.wants(m, state)).length;
  }

  /**
   * Deliver unread and live messages to `onMessage` until `signal` aborts,
   * announcing presence while listening. The cursor advances as messages are
   * handled, so a restart resumes exactly where this left off.
   */
  async listen(
    onMessage: (m: Message, state: ChannelState) => void | Promise<void>,
    opts: Delivery & { signal?: AbortSignal; client: string; onStatus?: (s: string) => void; onNotice?: (text: string) => void | Promise<void> },
  ): Promise<void> {
    // Lets the Claude Code Stop hook know this agent can hear the channel.
    const { registerListener } = await import("./hooks.ts");
    registerListener(this.alias, this.me);
    // Starting up when the relay is briefly out of reach (a deploy, a blip) waits and retries, like any drop later.
    let since = 0;
    let messages: Message[] = [];
    let state!: ChannelState;
    for (let backoff = 500, downSince = Date.now(), told = false; ; backoff = Math.min(backoff * 2, 30_000)) {
      try {
        await this.ownerChores();
        since = await this.cursor();
        ({ messages, state } = await this.state());
        if (told) opts.onStatus?.(`reached the relay after ${Math.round((Date.now() - downSince) / 1000)}s`);
        break;
      } catch (err) {
        // Gone (removed, closed) and refusals are answers, not outages.
        if (err instanceof ChannelGone || err instanceof Rejected || (err instanceof RelayError && err.status < 500 && err.status !== 429)) throw err;
        if (opts.signal?.aborted) return;
        if (!told && Date.now() - downSince >= QUIET_DROP_MS) {
          told = true;
          opts.onStatus?.(`can't reach the relay (${err instanceof Error ? err.message : String(err)}); still retrying`);
        }
        await Bun.sleep(backoff);
      }
    }
    const seen = readSeen(this.alias, this.me);
    const role = state.members.get(this.me)?.role;
    let lastQueryReply = 0;
    let announce: (() => void) | null = null;
    let beacon: ReturnType<typeof setInterval> | undefined;
    opts.signal?.addEventListener("abort", () => clearInterval(beacon), { once: true });

    await this.ch.stream(
      since,
      async (m) => {
        if (m.seq > (messages.at(-1)?.seq ?? 0)) {
          messages = [...messages, m];
          appendCache(this.cfg.roomId, [m]);
          state = await this.foldState(messages, await this.members());
          // From someone we don't know yet? We may have missed a roster update while offline:
          // check again before calling it forged and moving past it for good.
          if (state.trust.get(m.seq) === "forged") state = await this.foldState(messages, await this.members(true));
        }
        if (!seen.has(m.seq) && this.wants(m, state, opts)) await onMessage(m, state);
        writeCursor(this.alias, this.me, m.seq);
      },
      {
        signal: opts.signal,
        onStatus: opts.onStatus,
        onOpen: ({ presence }) => {
          // Members may have joined or left while we were disconnected.
          void this.members(true).catch(() => {});
          announce = () => void presence({ client: opts.client, ...(role ? { role } : {}) });
          announce();
          clearInterval(beacon);
          beacon = setInterval(() => announce?.(), PRESENCE_EVERY_MS);
        },
        onPresence: (p) => {
          // Answer "who's here?" probes, at most every few seconds.
          if (!p.query || Date.now() - lastQueryReply < 3_000) return;
          lastQueryReply = Date.now();
          announce?.();
        },
        onRoster: () => {
          this.postingChecked = false;
          void this.members(true).then(() => this.ownerChores());
        },
        onRequest: () => {
          if (!this.ownerCh || !opts.onNotice) return;
          void this.ownerCh.requests({ budget: signingBudget }).then(async (reqs) => {
            for (const r of reqs) {
              // A request becomes worth mentioning once both sides can see its code.
              if (r.check === "ready") {
                await opts.onNotice!(
                  `join request: "${r.name}"${r.role ? ` (${r.role})` : ""} wants in, verification code ${r.code}. ` +
                    `Only your human may approve: ask them to confirm the code matches what the joining agent shows, then run \`kiwi approve ${r.code}\` (or approve in the dashboard).`,
                );
              } else if (r.check === "unchecked") {
                await opts.onNotice!(`join request: "${r.name}" wants in, but this computer has checked its share of join requests today. ${TOO_MANY_REQUESTS}`);
              }
            }
          });
        },
      },
    );
    clearInterval(beacon);
  }

  /** Who is listening right now: probes the channel and collects answers. */
  async who(waitMs = 1_500): Promise<Map<string, Presence>> {
    const found = new Map<string, Presence>();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), waitMs);
    // Answers arrive within milliseconds of the query, so stop waiting once
    // they stop coming: each new answer restarts a short quiet window. A busy
    // channel typically resolves in ~0.5s instead of the full timeout.
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => ac.abort(), 400);
    };
    const [head, roster] = await Promise.all([this.ch.head(), this.members()]);
    await this.ch
      .stream(head, () => {}, {
        signal: ac.signal,
        onOpen: ({ presence }) => void presence({ client: "probe", query: true }),
        onPresence: (p) => {
          if (p.client === "probe" || p.from === this.me) return;
          // Only trust presence signed by the key the owner admitted under that name.
          if (!p.sigOk || roster.find((r) => r.name === p.from && r.active)?.pk !== p.pk) return;
          if (!found.has(p.from)) heard();
          const role = typeof p.role === "string" ? inlineText(p.role, 80) || undefined : undefined;
          found.set(p.from, { ...p, ...(typeof p.role === "string" ? { role } : {}) });
        },
      })
      .catch(() => {});
    clearTimeout(timer);
    clearTimeout(quiet);
    return found;
  }

  // ---------- messaging ----------

  /** Expand `role:x` recipients to the members holding that role. */
  async resolveTo(to: string[] | undefined, state?: ChannelState): Promise<string[] | undefined> {
    // "--to all": for everyone, on purpose. It reaches every agent; a message with no --to only reaches those following all chat.
    if (to?.some((t) => EVERYONE.has(t.toLowerCase()))) return ["*"];
    if (!to?.length || !to.some((t) => t.startsWith("role:"))) return to;
    const s = state ?? (await this.state()).state;
    const out = new Set<string>();
    for (const t of to) {
      if (!t.startsWith("role:")) {
        out.add(t);
        continue;
      }
      const role = t.slice(5).toLowerCase();
      for (const m of s.members.values()) if (m.role?.toLowerCase() === role) out.add(m.name);
    }
    if (!out.size) throw new Rejected(`no member has role ${to.filter((t) => t.startsWith("role:")).join(", ")}`);
    return [...out];
  }

  /** Send a message; `room` is a room's name or id (general if none). */
  async send(body: string, opts: SendOptions = {}): Promise<number> {
    const to = await this.resolveTo(opts.to);
    await this.mayI({ kind: opts.kind ?? "msg", ev: opts.ev, to });
    if (opts.kind !== "event" && !opts.esc) await this.mayTalkTo(to);
    // A reply goes in its parent's room unless told otherwise (fold puts it there anyway).
    const parent = !opts.room && opts.re?.length ? (await this.state()).state.roomOf.get(opts.re[0]!) : undefined;
    const room = opts.ev ? undefined : (parent ?? (await this.roomId(opts.room)));
    return this.ch.send(body, { ...opts, to, room });
  }

  /**
   * Strict coordinator-only: refuse here a message from an agent (not the coordinator) to a person.
   * Every client would refuse it anyway, so sending it would only leave a dead message in the log.
   */
  private async mayTalkTo(to: string[] | undefined): Promise<void> {
    if (!to?.length) return;
    const { state } = await this.state();
    const me = state.members.get(this.me);
    const { coordinatorOnly, strict } = state.mode;
    if (!coordinatorOnly || !strict || !state.coordinator || !me || me.kind === "human" || me.owner || this.me === state.coordinator) return;
    const people = to.filter((n) => { const p = state.members.get(n); return !!p && (p.kind === "human" || p.owner); });
    if (people.length) throw new Rejected(`this channel is coordinator-only: only ${state.coordinator} messages people. Send it to ${state.coordinator}, who passes it on.`);
  }

  /**
   * Refuse here what the owner hasn't let this member send: every client would refuse it in fold
   * anyway, so sending it would only leave a dead message in the log.
   */
  private async mayI(m: { kind: Kind; ev?: Event; to?: string[] }): Promise<void> {
    const { state } = await this.state();
    const me = state.members.get(this.me);
    const why = me && refusal(me.scopes, m);
    if (why) throw new Rejected(`the owner hasn't let you do that: you ${why} here (you may ${me.scopes.length ? describeScopes(me.scopes) : "only read"})`);
    const person = (n: string) => { const p = state.members.get(n); return !!p && isPerson(p); };
    if (state.hold && me && !isPerson(me) && !allowedOnHold(m, person)) throw new Rejected(`${ON_HOLD}${state.hold.note ? ` (${state.hold.note})` : ""}. Stop work and wait; answer people if they ask you something.`);
  }

  /**
   * Ask a question and, with `waitSec`, block until someone answers (a reply
   * referencing it). Returns the replies; they're marked seen so tail/wait
   * don't deliver them a second time.
   */
  async ask(body: string, opts: { to?: string[]; kind?: Kind; waitSec?: number; signal?: AbortSignal; imgs?: ImageAttachment[]; room?: string }): Promise<{ seq: number; replies: Message[] }> {
    const head = await this.ch.head();
    const seq = await this.send(body, { to: opts.to, kind: opts.kind ?? "ask", imgs: opts.imgs, room: opts.room });
    if (!opts.waitSec) return { seq, replies: [] };
    const replies = await this.awaitReplies(seq, head, opts.waitSec, opts.signal);
    return { seq, replies };
  }

  async awaitReplies(seq: number, since: number, waitSec: number, signal?: AbortSignal): Promise<Message[]> {
    const replies: Message[] = [];
    // Only answers signed by a key the owner admitted under the sender's name count.
    let roster = await this.members(true);
    const genuine = async (m: Message) => {
      const ok = () => !!m.sigOk && !!m.pk && roster.some((r) => r.name === m.from && r.pk === m.pk);
      if (ok()) return true;
      roster = await this.members(true);
      return ok();
    };
    const ac = new AbortController();
    signal?.addEventListener("abort", () => ac.abort(), { once: true });
    const timer = setTimeout(() => ac.abort(), waitSec * 1000);
    await this.ch.stream(
      since,
      async (m) => {
        if (m.from === this.me || !m.re?.includes(seq) || !(await genuine(m))) return;
        replies.push(m);
        // Linger briefly so several quick answers come back together.
        if (replies.length === 1) setTimeout(() => ac.abort(), 600);
      },
      { signal: ac.signal },
    );
    clearTimeout(timer);
    markSeen(this.alias, this.me, replies.map((r) => r.seq));
    return replies;
  }

  /** Reply to message #seq, addressed to its sender, in its room (a thread lives in one). */
  async reply(seq: number, body: string, kind: Kind = "msg", imgs?: ImageAttachment[]): Promise<number> {
    const { messages, state } = await this.state();
    const orig = messages.find((m) => m.seq === seq);
    if (!orig) throw new Rejected(`no message #${seq}`);
    const to = orig.from === this.me ? orig.to : [orig.from];
    await this.mayI({ kind, to });
    await this.mayTalkTo(to);
    return this.ch.send(body, { to, kind, re: [seq], imgs, room: state.roomOf.get(seq) ?? orig.room });
  }

  /** Announce yourself. After joining, a different role or rules is a request: the owner decides. */
  async hello(role?: string, about?: string): Promise<number> {
    return this.event({ op: "hello", role, about }, `joined${role ? ` as ${role}` : ""}`);
  }

  /**
   * Owner: set a member's role and rules, give them the role they asked for, or
   * refuse it. Sent as the owner, so every client checks it's the owner's word.
   */
  async decideRole(member: string, decision: { role: string | null; about?: string | null } | "allow" | "refuse"): Promise<number> {
    if (!this.ownerCh) throw new Rejected("only the channel owner's machine decides roles");
    const { state } = await this.state();
    const m = state.members.get(member);
    if (!m?.active) throw new Rejected(`no member named ${member}`);
    let ev: Event;
    if (decision === "refuse") ev = { op: "role.refuse", member };
    else if (decision === "allow") {
      if (!m.roleRequest) throw new Rejected(`${member} hasn't asked for a role`);
      ev = { op: "role.set", member, role: m.roleRequest.role ?? null, about: m.roleRequest.about ?? null };
    } else ev = { op: "role.set", member, ...decision };
    const seq = await this.ownerCh.send(ev.op === "role.refuse" ? `kept ${member}'s role` : `made ${member} ${ev.role ?? "unassigned"}`, { kind: "event", ev });
    // Then the member's record says it too, for clients holding only the log's tail. If this fails,
    // the owner's next reconcile puts it right; the role.set already counts for every client.
    if (ev.op === "role.set" && !m.owner) {
      const rec = (await this.ownerCh.members()).find((x) => x.active && x.name === member && x.pk === m.pk);
      if (rec) await this.ownerCh.updateRole(rec, ev.role, ev.about, seq).catch(() => {});
    }
    return seq;
  }

  /**
   * Owner: what a member may do besides read (null: everything). Signed by the owner key, so every
   * client checks it's the owner's word; it names the member's key, so it never carries over to
   * whoever is admitted under that name next. The relay is told the one bit it enforces itself.
   */
  async setScopes(member: string, scopes: Scope[] | null): Promise<ChannelState> {
    if (!this.ownerCh) throw new Rejected("only the channel owner's machine sets what members may do");
    const { state } = await this.state();
    const m = state.members.get(member);
    if (!m?.active) throw new Rejected(`no member named ${member}`);
    if (m.owner) throw new Rejected("the owner may do everything");
    const wire = wireScopes(scopes);
    const ev: Event = { op: "scope.set", member, pk: m.pk, scopes: wire };
    const seq = await this.ownerCh.send(`set what ${member} may do: ${wire ? describeScopes(wire) : "full"}`, { kind: "event", ev });
    const after = await this.confirm(seq);
    // Then the member's record says it too (for clients holding only the log's tail), with the relay's
    // bit. If this fails, ownerChores puts both right next time.
    const rec = (await this.ownerCh.members()).find((r) => r.pk === m.pk);
    await (rec ? this.ownerCh.updateScopes(rec, after.members.get(member)?.scopes ?? [], seq) : Promise.reject(new Error("no record"))).catch(() => {
      this.postingChecked = false;
    });
    return after;
  }

  /**
   * Owner: coordinator-only on or off. On, people talk only with the member whose role is
   * coordinator; strict (the default) has every client refuse other agents' messages to people.
   */
  async setMode(coordinatorOnly: boolean, strict = true): Promise<ChannelState> {
    if (!this.ownerCh) throw new Rejected("only the channel owner's machine sets the channel's mode");
    const ev = { op: "mode.set" as const, coordinatorOnly, strict: coordinatorOnly && strict };
    const body = coordinatorOnly ? `coordinator-only on${ev.strict ? " (strict)" : ""}` : "coordinator-only off";
    const since = await this.ownerCh.send(body, { kind: "event", ev });
    // Then the channel's settings say it too, for clients holding only the log's tail.
    await this.ownerCh.setMode({ coordinatorOnly, strict: ev.strict, since });
    return this.confirm(since);
  }

  /**
   * Owner: what the channel is for and where its limits are (null clears it). Every agent is shown it,
   * and told to escalate what falls outside it instead of doing it.
   */
  async setCharter(text: string | null): Promise<ChannelState> {
    if (!this.ownerCh) throw new Rejected("only the channel owner's machine sets the charter");
    const clean = text?.trim() || null;
    if (clean && clean.length > MAX_CHARTER) throw new Rejected(`a charter is at most ${MAX_CHARTER} characters`);
    const since = await this.ownerCh.send(clean ? `charter: ${clean}` : "cleared the charter", { kind: "event", ev: { op: "charter.set", text: clean } });
    // Then the settings say it too, for clients holding only the log's tail.
    await this.ownerCh.setCharter({ text: clean, since });
    this.guardFloor = undefined;
    return this.confirm(since);
  }

  /**
   * Owner: stop every agent, or let them carry on. While on hold every client refuses an agent's work
   * (tasks, claims, facts, messages to other agents); agents may still answer people.
   */
  async setHold(on: boolean, note?: string): Promise<ChannelState> {
    if (!this.ownerCh) throw new Rejected("only the channel owner's machine puts the channel on hold");
    const clean = note?.trim().slice(0, 500) || undefined;
    const since = await this.ownerCh.send(on ? `on hold${clean ? `: ${clean}` : ""}` : "hold lifted", { kind: "event", ev: { op: "hold.set", on, ...(clean ? { note: clean } : {}) } });
    await this.ownerCh.setHold({ on, ...(clean ? { note: clean } : {}), since });
    this.guardFloor = undefined;
    return this.confirm(since);
  }

  /**
   * Hand a decision to people instead of acting: a blocking question to this agent's own human and
   * the owner, about message #re when given. It reaches them in any mode, and on hold.
   */
  async escalate(body: string, re?: number): Promise<{ seq: number; to: string[] }> {
    const { messages, state } = await this.state();
    const me = state.members.get(this.me);
    if (me && isPerson(me)) throw new Rejected("escalating is for agents: you're a person, so you decide");
    if (re !== undefined && !messages.some((m) => m.seq === re)) throw new Rejected(`no message #${re}`);
    const to = [...new Set([humanOf(state, this.me), ownerOf(state)].filter((n): n is string => !!n))];
    if (!to.length) throw new Rejected("there's no person in this channel to escalate to");
    const seq = await this.send(body, { to, kind: "blocking", esc: true, ...(re !== undefined ? { re: [re] } : {}) });
    return { seq, to };
  }

  /**
   * A person's colour (null clears it). Signed by the person themself when it's
   * this session's own name, else by the owner key on this machine. The fold
   * refuses a colour someone else has, and colours on agents.
   */
  async setColor(member: string, color: Color | null): Promise<ChannelState> {
    const ch = member === this.me ? this.ch : this.ownerCh;
    if (!ch) throw new Rejected("only that person, or the channel owner's machine, sets their colour");
    const ev: Event = { op: "color.set", member, color };
    if (ch === this.ch) await this.mayI({ kind: "event", ev });
    return this.confirm(await ch.send(color ? `${member}'s colour is ${color}` : `cleared ${member}'s colour`, { kind: "event", ev }));
  }

  // ---------- events ----------

  private async event(ev: Event, body: string, to?: string[]): Promise<number> {
    await this.mayI({ kind: "event", ev });
    return this.ch.send(body, { kind: "event", ev, to: to?.length ? [...new Set(to)].filter((n) => n !== this.me) : undefined });
  }

  /** Send an event, then confirm the fold accepted it (it may lose a race). */
  private async confirm(seq: number): Promise<ChannelState> {
    const { state } = await this.state();
    const why = state.rejected.get(seq);
    if (why) throw new Rejected(why);
    return state;
  }

  async taskAdd(title: string, opts: { detail?: string; owner?: string; after?: number[]; needs?: string[]; review?: string } = {}): Promise<number> {
    const { state } = await this.state();
    for (const d of opts.after ?? []) if (!state.tasks.has(d)) throw new Rejected(`no task ${taskId(d)}`);
    const owner = opts.owner && (await this.resolveTo([opts.owner], state))?.[0];
    const review = opts.review === undefined ? undefined : this.reviewer(state, opts.review);
    const needs = normTags(opts.needs);
    return this.event(
      {
        op: "task.add",
        title,
        ...(opts.detail ? { detail: opts.detail } : {}),
        ...(owner ? { owner } : {}),
        ...(opts.after?.length ? { after: opts.after } : {}),
        ...(needs.length ? { needs } : {}),
        ...(review ? { review } : {}),
      },
      `task: ${title}`,
      [...(owner ? [owner] : []), ...(review && review !== "*" ? [review] : [])],
    );
  }

  /** "any" (or "*") is anyone but the task's owner; otherwise a current member, by name or role:x. */
  private reviewer(state: ChannelState, who: string): string {
    const w = who.trim();
    if (w === "*" || w.toLowerCase() === "any") return "*";
    const m = state.members.get(w);
    if (!m?.active) throw new Rejected(`no member named ${w} to review it (or say any)`);
    return w;
  }

  async taskClaim(id: number): Promise<ChannelState> {
    const { state } = await this.state();
    const t = state.tasks.get(id);
    if (!t) throw new Rejected(`no task ${taskId(id)}`);
    if (t.state === "done") throw new Rejected(`${taskId(id)} is already done`);
    if (t.state === "cancelled") throw new Rejected(`${taskId(id)} is cancelled`);
    if (t.owner && t.owner !== this.me) throw new Rejected(`${taskId(id)} is owned by ${t.owner}`);
    const waits = waitingOn(state, t);
    const seq = await this.event({ op: "task.claim", task: id }, `claimed ${taskId(id)}`);
    const after = await this.confirm(seq);
    if (waits.length) throw new Rejected(`claimed, but ${taskId(id)} is still waiting on ${waits.map(taskId).join(", ")}`);
    return after;
  }

  async taskUpdate(id: number, change: { state?: TaskState; owner?: string | null; title?: string; note?: string; after?: number[]; review?: string | null; handoff?: Handoff }): Promise<ChannelState> {
    const { state } = await this.state();
    const t = state.tasks.get(id);
    if (!t) throw new Rejected(`no task ${taskId(id)}`);
    if (change.state && !TASK_STATES.includes(change.state)) throw new Rejected(`state must be one of ${TASK_STATES.join(", ")}`);
    if (change.after?.length) this.checkAfter(state, id, change.after);
    const owner = change.owner ? (await this.resolveTo([change.owner], state))?.[0] : change.owner;
    const review = change.review ? this.reviewer(state, change.review) : change.review;
    // Said here rather than left to every client's fold: the doer can't mark its own reviewed work done.
    const me = state.members.get(this.me);
    const gate = review === undefined ? t.review : review || undefined;
    if (change.state === "done" && t.state !== "done" && gate && me && !isPerson(me) && (gate === "*" ? (owner ?? t.owner) === this.me || t.workedBy.includes(this.me) : gate !== this.me)) {
      throw new Rejected(`${taskId(id)} needs review by ${gate === "*" ? "someone who hasn't worked on it" : gate} before it's done: send it for review (kiwi task review ${taskId(id)})`);
    }
    // Tell whoever this concerns: the new owner, the current owner if it isn't
    // us, the creator when it's done or cancelled, and owners of tasks it unblocks.
    const notify: string[] = [];
    if (owner) notify.push(owner);
    if (t.owner && t.owner !== this.me) notify.push(t.owner);
    // In review: whoever must approve it hears; a named reviewer, or the one just named.
    const reviewerName = (review ?? t.review) !== "*" ? (review ?? t.review) : undefined;
    if ((change.state === "review" || review) && reviewerName) notify.push(reviewerName);
    if (change.state === "done" || change.state === "cancelled") {
      notify.push(t.createdBy);
      for (const other of state.tasks.values()) if (other.after.includes(id) && other.owner) notify.push(other.owner);
    }
    const seq = await this.event(
      { op: "task.update", task: id, ...change, ...(owner !== undefined ? { owner } : {}), ...(review !== undefined ? { review } : {}) },
      `${taskId(id)} ${change.handoff ? "handed over" : (change.state ?? "updated")}`,
      notify,
    );
    return this.confirm(seq);
  }

  /**
   * Hand a task to someone else with where it stands: the branch and commit to pick it up from, the
   * files in play, and what's next. This agent's claims on those files are let go, so the next owner
   * can claim them.
   */
  async taskHandoff(id: number, to: string, next: string | undefined, handoff: Handoff): Promise<ChannelState> {
    const { state: before } = await this.state();
    const target = (await this.resolveTo([to], before))?.[0];
    if (!target || !before.members.get(target)?.active) throw new Rejected(`no member named ${to}`);
    if (target === this.me) throw new Rejected("hand it to someone else");
    const state = await this.taskUpdate(id, { owner: target, ...(next ? { note: next } : {}), handoff, ...(before.tasks.get(id)?.state === "doing" ? { state: "todo" as const } : {}) });
    const files = handoff.files ?? [];
    const held = state.claims.filter((c) => c.owner === this.me && files.some((f) => overlaps(c.path, f))).map((c) => c.path);
    if (held.length) await this.release(held);
    return state;
  }

  /**
   * Say what this agent is and has (see card.ts): what's detected here, keeping what was said by hand
   * before unless `given` says it again. Sent only when it changed; people don't carry cards.
   */
  async refreshCard(detected: Card, given: { model?: string; note?: string; tools?: string[] } = {}): Promise<{ sent: boolean; card: Card }> {
    const { state } = await this.state();
    const me = state.members.get(this.me);
    const card = mergeCard(detected, me?.card, given);
    if (!me || isPerson(me) || !canPost(me.scopes) || state.hold || sameCard(me.card, card)) return { sent: false, card };
    await this.event({ op: "card", ...card }, `card: ${cardLine(card)}`);
    return { sent: true, card };
  }

  /** Append dependencies. Missing ids, self-deps and cycles are refused. */
  async taskAfter(id: number, deps: number[]): Promise<ChannelState> {
    if (!deps.length) throw new Rejected("name at least one task to wait on");
    const { state } = await this.state();
    this.checkAfter(state, id, deps);
    const seq = await this.event({ op: "task.update", task: id, after: deps }, `${taskId(id)} waits on ${deps.map(taskId).join(", ")}`);
    return this.confirm(seq);
  }

  private checkAfter(state: ChannelState, id: number, deps: number[]): void {
    if (!state.tasks.has(id)) throw new Rejected(`no task ${taskId(id)}`);
    for (const d of deps) {
      if (!state.tasks.has(d)) throw new Rejected(`no task ${taskId(d)}`);
      if (wouldCycle(state.tasks, id, d)) throw new Rejected(`${taskId(id)} waiting on ${taskId(d)} would cycle`);
    }
  }

  async claim(paths: string[], ttlSec: number, note?: string, place?: { machine?: string; checkout?: string }): Promise<ChannelState> {
    const { state } = await this.state();
    for (const p of paths) {
      const c = state.claims.find((x) => x.owner !== this.me && overlaps(x.path, p));
      if (c) throw new Rejected(claimConflict(c));
    }
    const seq = await this.event(
      { op: "claim", paths, ttl: ttlSec, ...(note ? { note } : {}), ...(place?.machine ? { machine: place.machine } : {}), ...(place?.checkout ? { checkout: place.checkout } : {}) },
      `claimed ${paths.join(", ")}`,
    );
    return this.confirm(seq);
  }

  async release(paths?: string[]): Promise<number> {
    return this.event({ op: "release", ...(paths?.length ? { paths } : {}) }, paths?.length ? `released ${paths.join(", ")}` : "released all claims");
  }

  async setFact(key: string, value: string, ttlSec?: number): Promise<number> {
    return this.event({ op: "fact.set", key, value, ...(ttlSec ? { ttl: ttlSec } : {}) }, `${key} = ${value}`);
  }

  async delFact(key: string): Promise<number> {
    return this.event({ op: "fact.del", key }, `unset ${key}`);
  }
}

export type { Presence };

/**
 * `AgentSession.wants`, for callers that have the state but no session (kiwi sh).
 * By default an agent gets what's for it: messages to it or its role, broadcasts
 * from people and broadcast questions, and every message in a thread it's in.
 * Other agents' conversations stay out unless it asks for all chat.
 */
export function wants(me: string, m: Message, state: ChannelState | null, d: Delivery = {}): boolean {
  if (m.from === me) return false;
  // Forged messages never reach an agent: they're noise at best, prompt injection at worst. Nor do
  // ones the owner didn't let their sender send (outside its scopes).
  if (ignored(state?.trust.get(m.seq))) return false;
  // One room only: other rooms' chat stays out; events are channel-wide.
  if (d.room !== undefined && m.kind !== "event" && (state?.roomOf.get(m.seq) ?? m.room ?? GENERAL_ROOM) !== d.room) return false;
  if (d.all) return true;
  // Any message of a thread names it: its root, or a reply in it.
  if (d.thread !== undefined) return m.kind !== "event" && (state?.threadOf.get(m.seq) ?? m.seq) === (state?.threadOf.get(d.thread) ?? d.thread);
  const role = state?.members.get(me)?.role;
  const addressed = isDirectedAt(m, me) || !!m.to?.includes("*") || (!!role && !!m.to?.includes(`role:${role}`));
  // Everyone hears when the channel's mode changes: it changes who they may talk to.
  // Everyone hears about a new or renamed room: it's somewhere they can now talk.
  // Everyone hears the charter and the hold: they change what anyone may do.
  if (m.kind === "event") return addressed || m.ev?.op === "hello" || m.ev?.op === "mode.set" || m.ev?.op === "room.create" || m.ev?.op === "room.rename" || m.ev?.op === "charter.set" || m.ev?.op === "hold.set";
  if (d.chat) return true;
  // Coordinator-only (with a coordinator in place): what people say goes to the coordinator, who
  // relays it. Another agent gets a person's message only if it's addressed to that agent by name.
  const sender = state?.members.get(m.from);
  if (state?.mode.coordinatorOnly && state.coordinator && sender && (sender.kind === "human" || sender.owner)) {
    return me === state.coordinator || isDirectedAt(m, me);
  }
  // A person reading from the CLI: in strict mode, other agents' words don't reach them at all.
  const self = state?.members.get(me);
  if (state && self && (self.kind === "human" || self.owner) && keptFromPeople(state, m)) return false;
  const asking = isForAgent(m, me) && (m.kind === "ask" || m.kind === "blocking");
  if (d.forMe) return addressed || asking;
  const fromPerson = !m.to?.length && (sender?.kind === "human" || !!sender?.owner);
  const inMyThread = !!state?.threadPeople.get(state.threadOf.get(m.seq) ?? m.seq)?.has(me);
  return addressed || asking || fromPerson || inMyThread;
}
