import * as Effect from "effect/Effect";
import type { GithubFx } from "./github.ts";
import type { ChannelAccess } from "../crypto.ts";
import type { Identity } from "../identity.ts";
import { OwnerOnly } from "../refusals.ts";
import { gone, type MemberRefusal } from "./errors.ts";
import type { DelegationsFx } from "./delegations.ts";
import type { HistoryFx } from "./history.ts";
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

import type { RoomMeta, RoomNow, RoomSeal } from "../private-room.ts";
export interface ChannelFx extends KeysFx, InfoFx, SettingsFx, RequestsFx, MembersFx, DelegationsFx, HistoryFx, SnapshotsFx, SendFx, ImagesFx, LiveFx, GithubFx {}

export class ChannelCore {
  readonly name: string;
  fx!: ChannelFx;
  rotating = false;
  readonly roomKeys = new Map<string, string>();
  readonly hidden = new Set<number>();
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
