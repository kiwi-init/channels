import * as Effect from "effect/Effect";
import type { GithubFx } from "./github.ts";
import type { ChannelAccess } from "../crypto.ts";
import type { Identity } from "../identity.ts";
import { OwnerOnly } from "../refusals.ts";
import { gone, type MemberRefusal } from "./errors.ts";
import type { DelegationsFx } from "./delegations.ts";
import type { HistoryFx } from "./history.ts";
import type { FilesFx } from "./files.ts";
import type { ImagesFx } from "./images.ts";
import type { InfoFx } from "./info.ts";
import type { KeysFx } from "./keys.ts";
import type { LiveFx } from "./live.ts";
import type { MembersFx } from "./members.ts";
import { callRelay, type CallInit, type Relay } from "./relay.ts";
import type { RequestsFx } from "./requests.ts";
import type { SendFx } from "./send.ts";
import type { SettingsFx } from "./settings.ts";
import type { SnapshotsFx } from "./snapshots.ts";

import type { RoomMember, RoomMeta, RoomNow, RoomSeal } from "../room-rules.ts";
import type { Message } from "../protocol.ts";
export interface ChannelFx extends KeysFx, InfoFx, SettingsFx, RequestsFx, MembersFx, DelegationsFx, HistoryFx, SnapshotsFx, SendFx, ImagesFx, FilesFx, LiveFx, GithubFx {}

export class ChannelCore {
  readonly name: string;
  fx!: ChannelFx;
  rotating = false;
  readonly roomKeys = new Map<string, string>();
  readonly hidden = new Set<number>();
  readonly publicRooms = new Set<string>();
  readonly memberRooms = new Map<string, { members: RoomMember[]; dm?: true; self?: true }>();
  readonly roomNow = new Map<string, RoomNow>();
  readonly roomSeals = new Map<string, { seq: number; seal: RoomSeal }[]>();
  readonly sealSteps = new Map<number, { proven?: boolean; opened?: RoomMeta }>();
  opensRooms = true;

  constructor(
    public access: ChannelAccess,
    readonly relay: string,
    readonly identity: Identity,
    readonly onAccess?: (a: ChannelAccess) => void,
  ) {
    this.name = identity.name;
  }

  learnRoom(m: Message): void {
    const ev = m.ev;
    if (ev?.op === "room.create" && !ev.members) this.publicRooms.add(ev.id);
    else if ((ev?.op === "room.create" || ev?.op === "room.members") && ev.members)
      this.memberRooms.set(ev.id, { members: ev.members, ...(ev.dm ? { dm: true as const } : {}), ...(ev.self ? { self: true as const } : {}) });
    else if (ev?.op === "room.leave" && m.from === this.name) this.memberRooms.delete(ev.id);
  }

  learnBase(rooms: readonly { id: string; members?: RoomMember[]; dm?: true; self?: true }[]): void {
    for (const r of rooms)
      if (!r.members) this.publicRooms.add(r.id);
      else if (!this.memberRooms.has(r.id)) this.memberRooms.set(r.id, { members: r.members, ...(r.dm ? { dm: true as const } : {}), ...(r.self ? { self: true as const } : {}) });
  }

  get roomId(): string {
    return this.access.roomId;
  }

  get isOwner(): boolean {
    return this.identity.pk === this.access.ownerPk;
  }

  request<T>(path: string, init: CallInit = {}, params: Record<string, string | number> = {}): Effect.Effect<T, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      return yield* callRelay<T>(this.relay, this.roomId, path, { ...init, identity: this.identity }, params);
    }).pipe(Effect.mapError(gone));
  }

  ownerOnly(): Effect.Effect<void, OwnerOnly> {
    return this.isOwner ? Effect.void : Effect.fail(new OwnerOnly("only the channel owner can do that"));
  }
}
