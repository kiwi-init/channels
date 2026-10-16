import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { openRows as openSealedRows, packRow, type CachedRow } from "../../src/cache-row.ts";
import { Channel, ChannelGone, RelayError, Relay, Unreachable, eachLive, fetchRelay, type Live, type PresenceFields } from "../../src/client.ts";
import type { ChannelAccess } from "../../src/crypto.ts";
import { generateIdentity, type Identity } from "../../src/identity.ts";
import { handleFor, type Member, type MemberInfo } from "../../src/membership.ts";
import type { PersonClaim } from "../../src/person.ts";
import type { Message } from "../../src/protocol.ts";
import type { SigningBudget } from "../../src/sas.ts";
import { CHANNEL_CALLS, type CallResult, type ChannelCallName, type ChannelCalls, type ChannelIdentityView, type ChannelOps, type ChannelView, type FollowEvent, type JoinCheck, type KeysPush, type KeysReply, type WireError } from "./bridge.ts";
import { channelAccess, publicChannel } from "./seats.ts";
import { fromWire, toWire } from "./wire.ts";

export interface KeyHost {
  relay(): string;
  seats(): readonly ChannelIdentityView[];
  save(entry: ChannelIdentityView): Promise<void>;
  access(code: string, pk: string, access: ChannelAccess): Promise<void>;
  forget(code: string): Promise<void>;
  prove(code: string, memberPk: string): Promise<PersonClaim | null>;
  person(): string | null;
  budget: SigningBudget;
}

const runtime = ManagedRuntime.make(Layer.succeed(Relay, fetchRelay));

const identityOf = (c: ChannelIdentityView): Identity => ({ name: c.idName ?? c.label, pk: c.pk, sk: c.sk, ...(c.xpk ? { xpk: c.xpk } : {}), ...(c.xsk ? { xsk: c.xsk } : {}) });

const keysOf = (id: Identity): Pick<ChannelIdentityView, "pk" | "sk" | "xpk" | "xsk"> => ({ pk: id.pk, sk: id.sk, ...(id.xpk ? { xpk: id.xpk } : {}), ...(id.xsk ? { xsk: id.xsk } : {}) });

const isCall = (name: unknown): name is ChannelCallName => typeof name === "string" && (CHANNEL_CALLS as readonly string[]).includes(name);

const field = (v: unknown, k: string): unknown => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined);

function asOf(v: unknown): Partial<MemberInfo> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("bad request");
  return v as Partial<MemberInfo>;
}

export function editable(m: Member | undefined): Member {
  if (!m || !m.active || m.unverified || m.owner) throw new Error("that member isn't one whose record you can change");
  return m;
}

function wireError(e: unknown): WireError {
  if (e instanceof ChannelGone) return { kind: "gone", why: e.why };
  if (e instanceof RelayError) return { kind: "relay", status: e.status, message: e.message, ...(e.tagged ? { tag: e.tag } : {}) };
  if (e instanceof Unreachable) return { kind: "unreachable", message: e.cause instanceof Error ? e.cause.message : "can't reach the relay" };
  if (e instanceof TypeError) return { kind: "unreachable", message: e.message };
  if (e instanceof Error) {
    const tag: unknown = (e as { _tag?: unknown })._tag;
    return { kind: "other", message: e.message, ...(typeof tag === "string" ? { tag } : {}) };
  }
  return { kind: "other", message: String(e) };
}

interface Follow {
  code: string;
  stop: () => void;
  presence: ((p: PresenceFields) => Effect.Effect<void>) | null;
}

export class Keyring implements ChannelOps {
  private readonly open = new Map<string, Channel>();
  private readonly follows = new Map<number, Follow>();
  private nextSub = 1;

  constructor(private readonly host: KeyHost) {}

  private seat(code: string, member: boolean): ChannelIdentityView {
    const s = this.host.seats().find((c) => c.code === code && (member ? !!c.access : !c.access));
    if (!s) throw new Error(member ? "this app isn't in that channel" : "this app has no join request for that channel");
    return s;
  }

  private channel(code: string): Channel {
    const seat = this.seat(code, true);
    const access = channelAccess(seat);
    if (!access) throw new Error("this app has no keys for that channel");
    const key = `${code}\n${seat.pk}`;
    const relay = this.host.relay();
    const had = this.open.get(key);
    if (had && had.relay === relay) {
      if (access.epoch > had.access.epoch || Object.keys(access.keys).some((e) => !had.access.keys[e])) had.access = { ...had.access, ...access, keys: { ...had.access.keys, ...access.keys } };
      return had;
    }
    const ch = new Channel(access, relay, identityOf(seat), (a) => void this.host.access(code, seat.pk, a).catch(() => {}));
    this.open.set(key, ch);
    return ch;
  }

  async callRaw(code: string, op: ChannelCallName, args: readonly unknown[]): Promise<unknown> {
    if (!isCall(op)) throw new Error("no such call");
    const ch = this.channel(code);
    const list = await this.trusted(ch, op, args);
    const fn = ch[op] as unknown as (...a: unknown[]) => Promise<unknown>;
    return fn.apply(ch, list);
  }

  private async trusted(ch: Channel, op: ChannelCallName, args: readonly unknown[]): Promise<unknown[]> {
    const person = this.host.person();
    const who = person ? { person } : {};
    switch (op) {
      case "requests":
        return [{ budget: this.host.budget, ...(field(args[0], "person") !== undefined ? who : {}) }];
      case "autoApprove":
        if (!person) throw new Error("make your person key first");
        return [person];
      case "approve":
      case "checkRequest": {
        const id = field(args[0], "id");
        const req = (await ch.requests()).find((r) => r.id === id);
        if (!req) throw new Error("that join request isn't waiting any more");
        return op === "approve" ? [req, asOf(args[1]), who] : [req];
      }
      case "updateScopes":
      case "updateRole":
      case "updateNickname": {
        const pk = field(args[0], "pk");
        return [editable((await ch.members()).find((x) => x.pk === pk)), ...args.slice(1)];
      }
      case "reconcilePosting":
        return [args[0]];
      default:
        return [...args];
    }
  }

  call<K extends ChannelCallName>(code: string, op: K, ...args: Parameters<ChannelCalls[K]>): Promise<CallResult<K>> {
    return this.callRaw(code, op, args) as Promise<CallResult<K>>;
  }

  async create(name: string, token: string | null, me: { name: string } | null): Promise<ChannelView> {
    const handle = me ? handleFor(me.name) : "human";
    const owner = await generateIdentity(handle);
    const info = me ? { name: handle, role: "owner", kind: "human" as const, display: me.name } : { name: "human", role: "owner" };
    const { code, access } = await Channel.create(this.host.relay(), owner, info, [], undefined, token, name);
    const entry: ChannelIdentityView = { label: name, idName: owner.name, ...keysOf(owner), roomId: access.roomId, code, access, at: Date.now(), name };
    await this.host.save(entry);
    await this.channel(code)
      .startCoordinated()
      .catch(() => {});
    return publicChannel(entry);
  }

  async requestJoin(code: string, name: string, role?: string): Promise<ChannelView> {
    const prior = this.host.seats().find((c) => c.code === code && !c.access && !c.imported);
    const identity = prior && (prior.idName ?? prior.label) === name ? identityOf(prior) : await generateIdentity(name);
    const claim = await this.host.prove(code, identity.pk);
    const r = await Channel.requestJoin(this.host.relay(), code, identity, { name, ...(role ? { role } : {}) }, claim ? { person: claim } : undefined);
    const entry: ChannelIdentityView = { label: identity.name, idName: identity.name, ...keysOf(identity), code, requestId: r.requestId };
    await this.host.save(entry);
    return publicChannel(entry);
  }

  async joinStatus(code: string): Promise<JoinCheck> {
    const seat = this.seat(code, false);
    const id = identityOf(seat);
    const st = await Channel.joinStatus(this.host.relay(), code, id, seat.requestId ?? "");
    if (st.status === "denied") return { status: "denied" };
    if (st.status === "pending") return { status: "pending", code: st.code };
    const members: Member[] = await new Channel(st.access, this.host.relay(), id).members().catch(() => []);
    const record = members.find((x) => x.pk === id.pk);
    const idName = record && record.name !== id.name ? record.name : id.name;
    const entry: ChannelIdentityView = { label: idName, idName, ...keysOf(id), roomId: st.access.roomId, code, access: st.access, at: Date.now() };
    await this.host.save(entry);
    return { status: "in", channel: publicChannel(entry) };
  }

  async forget(code: string): Promise<void> {
    for (const [sub, f] of this.follows) {
      if (f.code !== code) continue;
      f.stop();
      this.follows.delete(sub);
    }
    for (const k of [...this.open.keys()]) if (k.startsWith(`${code}\n`)) this.open.delete(k);
    await this.host.forget(code);
  }

  async presence(code: string, p: PresenceFields): Promise<void> {
    const f = [...this.follows.values()].find((x) => x.code === code && x.presence);
    if (f?.presence) await Effect.runPromise(f.presence(p));
  }

  async openRows(code: string, rows: readonly unknown[]): Promise<(Message | null)[]> {
    const access = channelAccess(this.seat(code, true));
    if (!access) return rows.map(() => null);
    return openSealedRows(rows, access.roomId, access.keys);
  }

  follow(code: string, since: number, on: (e: FollowEvent) => void): () => void {
    let ch: Channel;
    try {
      ch = this.channel(code);
    } catch (e) {
      on({ _tag: "Failed", error: wireError(e) });
      return () => {};
    }
    const sub = this.nextSub++;
    const f: Follow = { code, stop: () => {}, presence: null };
    const handle = (ev: Live): Effect.Effect<void> =>
      Effect.promise(async () => {
        const out = await this.event(ch, ev, f);
        if (out) on(out);
      });
    const status = (line: string): Effect.Effect<void> => Effect.sync(() => on({ _tag: "Status", line }));
    const program = eachLive(ch.fx.live(Math.max(0, since), { presence: true, send: true }), handle, status).pipe(
      Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => on({ _tag: "Failed", error: wireError(Cause.squash(cause)) })))),
    );
    const fiber = runtime.runFork(program);
    f.stop = () => void Effect.runFork(Fiber.interrupt(fiber));
    this.follows.set(sub, f);
    return () => {
      f.stop();
      this.follows.delete(sub);
    };
  }

  private async event(ch: Channel, ev: Live, f: Follow): Promise<FollowEvent | null> {
    switch (ev._tag) {
      case "Open":
        f.presence = ev.presence;
        return { _tag: "Open", kind: ev.kind };
      case "Message": {
        const key = ch.access.keys[String(ch.access.epoch)];
        const row: CachedRow | null = key && Number.isSafeInteger(ev.message.seq) && ev.message.seq > 0 ? await packRow(key, ch.roomId, ch.access.epoch, ev.message).catch(() => null) : null;
        return { _tag: "Message", message: ev.message, row };
      }
      case "Presence":
        return { _tag: "Presence", presence: ev.presence };
      case "Read":
        return { _tag: "Read", reads: [...ev.reads], snapshot: ev.snapshot };
      case "Info":
      case "Roster":
      case "Request":
        return { _tag: ev._tag };
      default:
        return null;
    }
  }

  stopAll(): void {
    for (const f of this.follows.values()) f.stop();
    this.follows.clear();
  }
}

const text = (v: unknown): string => {
  if (typeof v !== "string") throw new Error("bad request");
  return v;
};

const count = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new Error("bad request");
  return v;
};

function meOf(v: unknown): { name: string } | null {
  if (v === null || v === undefined) return null;
  return { name: text((v as { name?: unknown }).name) };
}

export interface KeysSession {
  handle(raw: unknown): Promise<KeysReply | null>;
  close(): void;
}

export function serveKeys(k: Keyring, push: (p: KeysPush) => void): KeysSession {
  const subs = new Map<number, () => void>();
  const run = async (r: Record<string, unknown>, id: number): Promise<unknown> => {
    switch (r.op) {
      case "call": {
        if (!isCall(r.name)) throw new Error("no such call");
        const args = fromWire(r.args);
        if (!Array.isArray(args)) throw new Error("bad request");
        return k.callRaw(text(r.code), r.name, args);
      }
      case "create":
        return k.create(text(r.name), r.token === null ? null : text(r.token), meOf(r.me));
      case "requestJoin":
        return k.requestJoin(text(r.code), text(r.name), r.role === undefined ? undefined : text(r.role));
      case "joinStatus":
        return k.joinStatus(text(r.code));
      case "forget":
        return k.forget(text(r.code));
      case "presence": {
        const p = fromWire(r.p);
        if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("bad request");
        return k.presence(text(r.code), p as PresenceFields);
      }
      case "openRows": {
        const rows = fromWire(r.rows);
        return k.openRows(text(r.code), Array.isArray(rows) ? rows : []);
      }
      case "follow": {
        const stop = k.follow(text(r.code), count(r.since), (event) => push({ sub: id, event: toWire(event) }));
        subs.set(id, stop);
        return id;
      }
      case "unfollow": {
        const sub = count(r.sub);
        subs.get(sub)?.();
        subs.delete(sub);
        return null;
      }
      default:
        throw new Error("bad request");
    }
  };
  return {
    handle: async (raw) => {
      if (!raw || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== "number") return null;
      const id = r.id;
      try {
        return { id, ok: true, value: toWire(await run(r, id)) };
      } catch (e) {
        return { id, ok: false, error: wireError(e) };
      }
    },
    close: () => {
      for (const stop of subs.values()) stop();
      subs.clear();
    },
  };
}

export type HostToKeys =
  | { type: "init"; relay: string; dir: string; seats: ChannelIdentityView[]; person: string | null }
  | { type: "seats"; seats: ChannelIdentityView[]; person: string | null }
  | { type: "flush" }
  | { type: "relay"; relay: string }
  | { type: "port" }
  | { type: "done"; id: number; error?: string; claim?: PersonClaim | null };

export type KeysToHost =
  | { type: "save"; id: number; entry: ChannelIdentityView }
  | { type: "access"; id: number; code: string; pk: string; access: ChannelAccess }
  | { type: "forget"; id: number; code: string }
  | { type: "prove"; id: number; code: string; memberPk: string }
  | { type: "flushed"; id: 0 };
