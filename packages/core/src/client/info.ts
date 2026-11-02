import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { open, ownerFingerprint } from "../crypto.ts";
import { sign, verify } from "../identity.ts";
import { delegatedMember, readDelegation } from "../delegation.ts";
import { readRecord, type Member } from "../membership.ts";
import { MAX_ICON_BYTES, wellFormedIcon, type ChannelIcon } from "../protocol.ts";
import { MissingKey, Rejected } from "../refusals.ts";
import type { ChannelCore } from "./core.ts";
import { gone, type MemberRefusal, type Refusal, type Refused } from "./errors.ts";
import { titlesSigned } from "./keys.ts";
import { callUnlessUnchanged, type Relay } from "./relay.ts";
import { freshInfo, newestEpoch, noteSeen, notOlder, openSealed, ownerSigned, sealFor, signedAt, type SealedBlob } from "./sealed.ts";

export const INFO_MAX_AGE_MS = 30_000;

export interface Info {
  ownerPk: string;
  ownerXpk: string;
  ownerSig: string;
  titlesSig?: string | null;
  epoch: number;
  rotate: boolean;
  title?: SealedBlob | null;
  iconAt?: number | null;
  settings?: SealedBlob | null;
  blobs?: boolean;
  sealedEpoch?: boolean;
}

export type MemberRow = { pk: string; xpk: string; rec: string; e: number; active: number; read_only?: number; d?: string };

export interface InfoFx {
  info(fp?: string): Effect.Effect<Info, Refusal, Relay>;
  title(): Effect.Effect<string | null, Refusal, Relay>;
  setTitle(name: string): Effect.Effect<void, Refused, Relay>;
  icon(): Effect.Effect<ChannelIcon | null, MemberRefusal, Relay>;
  setIcon(icon: ChannelIcon | null): Effect.Effect<void, Refused, Relay>;
  resealTitle(): Effect.Effect<void, Refused, Relay>;
  resealIcon(): Effect.Effect<void, Refused, Relay>;
  members(rows?: readonly MemberRow[]): Effect.Effect<Member[], MemberRefusal, Relay>;
  memberRows(): Effect.Effect<MemberRow[], MemberRefusal, Relay>;
}

export class ChannelInfo {
  private infoShared: Fiber.Fiber<Info, Refusal> | null = null;
  private infoExpires: number | null = null;

  constructor(
    private readonly ch: ChannelCore,
    private readonly opts: { keepInfo?: boolean; infoMaxAgeMs?: number },
  ) {}

  forgetInfo(): void {
    this.infoShared = null;
    this.infoExpires = null;
  }

  markGone(pk: string): void {
    if (this.keepsGone(pk)) rememberGone(this.ch.roomId, pk);
  }

  removed(pk: string): boolean {
    return isGone(this.ch.roomId, pk);
  }

  readonly fx: InfoFx = {
    info: Effect.fn("Channel.info")({ self: this }, function* (this: ChannelInfo, fp?: string) {
      if (fp !== undefined) return yield* this.fetchInfo(fp);
      if (this.infoExpires !== null && Date.now() >= this.infoExpires) this.forgetInfo();
      let shared = this.infoShared;
      if (!shared) {
        const fiber = yield* Effect.forkDetach(this.fetchInfo());
        shared = this.infoShared = fiber;
        const keep = !!this.opts.keepInfo;
        const maxAge = this.opts.infoMaxAgeMs ?? INFO_MAX_AGE_MS;
        fiber.addObserver((exit) => {
          if (this.infoShared !== fiber) return;
          if (!keep || Exit.isFailure(exit)) this.forgetInfo();
          else this.infoExpires = Date.now() + maxAge;
        });
      }
      return structuredClone(yield* Fiber.join(shared));
    }),

    title: Effect.fn("Channel.title")({ self: this }, function* (this: ChannelInfo) {
      const info = yield* this.ch.fx.info();
      const t = info.title;
      if (!t) return null;
      const opened = (yield* openSealed(this.ch, t)) as { what?: unknown; room?: unknown; name?: unknown; at?: unknown; pk?: string; sig?: string } | null;
      if (!opened || typeof opened.name !== "string") return null;
      const name = opened.name.slice(0, 80);
      if (!name) return null;
      const byOwner = opened.what === "channel-title" && opened.room === this.ch.roomId && opened.pk === this.ch.access.ownerPk && (yield* Effect.promise(() => verify(opened)));
      if (byOwner) {
        if (!notOlder(this.ch, "seenTitleAt", opened.at)) return null;
        this.noteSignedTitle();
        return name;
      }
      if (opened.what !== undefined || opened.room !== undefined || opened.pk !== undefined || opened.sig !== undefined) return null;
      if ((yield* Effect.promise(() => titlesSigned(this.ch.roomId, info.ownerPk, info.titlesSig))) || this.ch.access.signedTitle) return null;
      return name;
    }),

    setTitle: Effect.fn("Channel.setTitle")({ self: this }, function* (this: ChannelInfo, name: string) {
      yield* this.ch.ownerOnly();
      const title = name.trim().slice(0, 80);
      if (!title) return yield* new Rejected("a channel title can't be empty");
      const info = yield* freshInfo(this.ch, () => this.forgetInfo());
      const current = info.title ? yield* ownerSigned(this.ch, info.title, "channel-title") : null;
      const at = signedAt(this.ch, "seenTitleAt", current?.at);
      const signed = yield* Effect.promise(() => sign(this.ch.identity, { what: "channel-title", room: this.ch.roomId, name: title, at }));
      const sealed = yield* sealFor(this.ch, info, signed);
      if (!sealed) return yield* new MissingKey("missing the channel key");
      yield* this.ch.request("/title", { method: "PUT", body: JSON.stringify({ title: sealed }) }).pipe(Effect.ensuring(Effect.sync(() => this.forgetInfo())));
      noteSeen(this.ch, "seenTitleAt", at);
      this.noteSignedTitle();
    }),

    icon: Effect.fn("Channel.icon")({ self: this }, function* (this: ChannelInfo) {
      const { icon } = yield* this.ch.request<{ icon: { e: number; iv: string; ct: string } | null }>("/icon");
      if (!icon) return null;
      if (!this.ch.access.keys[String(icon.e)]) yield* this.ch.fx.refreshKeys();
      const key = this.ch.access.keys[String(icon.e)];
      if (!key) return null;
      const opened = (yield* Effect.promise(() => open(key, this.ch.roomId, icon.iv, icon.ct).catch(() => null))) as {
        what?: unknown;
        room?: unknown;
        icon?: unknown;
        at?: unknown;
        pk?: string;
        sig?: string;
      } | null;
      if (!opened || opened.what !== "channel-icon" || opened.room !== this.ch.roomId || opened.pk !== this.ch.access.ownerPk || !(yield* Effect.promise(() => verify(opened)))) return null;
      if (!notOlder(this.ch, "seenIconAt", opened.at)) return null;
      return wellFormedIcon(opened.icon) ? opened.icon : null;
    }),

    setIcon: Effect.fn("Channel.setIcon")({ self: this }, function* (this: ChannelInfo, icon: ChannelIcon | null) {
      yield* this.ch.ownerOnly();
      if (icon !== null && !wellFormedIcon(icon)) return yield* new Rejected(`an icon is a robot head, one emoji, or a png, jpg, gif or webp image of at most ${MAX_ICON_BYTES / 1024}KB`);
      const info = yield* freshInfo(this.ch, () => this.forgetInfo());
      const { icon: was } = yield* this.ch.request<{ icon: SealedBlob | null }>("/icon");
      const current = was ? yield* ownerSigned(this.ch, was, "channel-icon") : null;
      const at = signedAt(this.ch, "seenIconAt", current?.at);
      const signed = yield* Effect.promise(() => sign(this.ch.identity, { what: "channel-icon", room: this.ch.roomId, icon, at }));
      const sealed = yield* sealFor(this.ch, info, signed, true);
      if (!sealed) return yield* new MissingKey("missing the channel key");
      yield* this.ch.request("/icon", { method: "PUT", body: JSON.stringify({ icon: sealed }) }).pipe(Effect.ensuring(Effect.sync(() => this.forgetInfo())));
      noteSeen(this.ch, "seenIconAt", at);
    }),

    resealTitle: Effect.fn("Channel.resealTitle")({ self: this }, function* (this: ChannelInfo) {
      yield* this.ch.ownerOnly();
      this.forgetInfo();
      const info = yield* this.ch.fx.info();
      if (!info.sealedEpoch || !info.title || (info.title.e ?? 0) >= newestEpoch(this.ch.access.keys)) return;
      const name = yield* this.ch.fx.title();
      if (name) yield* this.ch.fx.setTitle(name);
    }),

    resealIcon: Effect.fn("Channel.resealIcon")({ self: this }, function* (this: ChannelInfo) {
      yield* this.ch.ownerOnly();
      const { icon: sealed } = yield* this.ch.request<{ icon: { e: number } | null }>("/icon");
      if (!sealed || sealed.e >= newestEpoch(this.ch.access.keys)) return;
      const icon = yield* this.ch.fx.icon();
      if (icon) yield* this.ch.fx.setIcon(icon);
    }),

    memberRows: Effect.fn("Channel.memberRows")({ self: this }, function* (this: ChannelInfo) {
      const { members } = yield* callUnlessUnchanged<{ members: MemberRow[] }>(this.ch.relay, this.ch.roomId, "members", "/members", { identity: this.ch.identity }).pipe(Effect.mapError(gone));
      return members;
    }),

    members: Effect.fn("Channel.members")({ self: this }, function* (this: ChannelInfo, rows?: readonly MemberRow[]) {
      const members = rows ?? (yield* this.ch.fx.memberRows());
      const out: Member[] = [];
      for (const m of members) {
        if (!this.ch.access.keys[String(m.e)]) yield* this.ch.fx.refreshKeys();
        const key = this.ch.access.keys[String(m.e)];
        const read = key ? yield* Effect.promise(() => readRecord(key, m.rec, this.ch.roomId, m.pk, this.ch.access.ownerPk)) : null;
        const opened = !read ? undefined : read.signer === this.ch.access.ownerPk ? read.member : yield* Effect.promise(() => delegatedRecord(read, m.d, this.ch.roomId, this.ch.access.ownerPk));
        const member = opened && newestRecord(this.ch.roomId, opened, !m.active && this.keepsGone(m.pk));
        if (member) out.push({ ...member, active: !!m.active && member.active, ...(m.read_only ? { readOnly: true } : {}) });
        else if (m.active && !isGone(this.ch.roomId, m.pk)) out.push({ name: `unverified-${m.pk.slice(0, 6)}`, pk: m.pk, xpk: m.xpk, owner: false, at: 0, active: true, unverified: true });
      }
      return out;
    }),
  };

  private fetchInfo(fp?: string): Effect.Effect<Info, Refusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const ownerPk = this.ch.access.ownerPk;
      const proof = fp ?? (ownerPk ? yield* Effect.promise(() => ownerFingerprint(ownerPk)) : undefined);
      return yield* callUnlessUnchanged<Info>(this.ch.relay, this.ch.roomId, "info", "/info", {}, proof ? { fp: proof } : {});
    });
  }

  private keepsGone(pk: string): boolean {
    return this.ch.isOwner && pk !== this.ch.access.ownerPk;
  }

  private noteSignedTitle(): void {
    if (this.ch.access.signedTitle) return;
    this.ch.access = { ...this.ch.access, signedTitle: true };
    this.ch.onAccess?.(this.ch.access);
  }
}

export async function delegatedRecord(read: NonNullable<Awaited<ReturnType<typeof readRecord>>>, d: string | undefined, room: string, ownerPk: string): Promise<Member | undefined> {
  const delegation = d ? await readDelegation(d, room, ownerPk) : null;
  return delegation && delegatedMember(read, delegation) ? { ...read.member, signedBy: delegation.delegate } : undefined;
}

export interface RecordMemory {
  get(room: string, pk: string): Member | null;
  set(room: string, pk: string, m: Member): void;
}
const inProcess = new Map<string, Member>();
let recordMemory: RecordMemory = {
  get: (room, pk) => inProcess.get(`${room}/${pk}`) ?? null,
  set: (room, pk, m) => void inProcess.set(`${room}/${pk}`, m),
};
export function keepRecordsIn(memory: RecordMemory): void {
  recordMemory = memory;
}
export function wasRemoved(room: string, pk: string): boolean {
  return isGone(room, pk);
}

function isGone(room: string, pk: string): boolean {
  return recordMemory.get(room, pk)?.active === false;
}

function rememberGone(room: string, pk: string): void {
  const seen = recordMemory.get(room, pk);
  if (seen?.active !== false) recordMemory.set(room, pk, { ...(seen ?? { name: "", pk, xpk: "", owner: false, at: 0 }), active: false });
}

function newestRecord(room: string, served: Member, leaving: boolean): Member {
  const seen = recordMemory.get(room, served.pk);
  const gone = leaving || seen?.active === false;
  const newest = seen && ((served.signedBy && !seen.signedBy) || seen.at > served.at) ? seen : served;
  if (newest === served && (!seen || served.at > seen.at)) recordMemory.set(room, served.pk, { ...served, active: !gone });
  else if (gone) rememberGone(room, served.pk);
  return { ...newest, active: !gone };
}
