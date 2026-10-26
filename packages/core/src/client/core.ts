import * as Effect from "effect/Effect";
import type { GithubFx } from "./github.ts";
import type { ChannelAccess } from "../crypto.ts";
import type { Identity } from "../identity.ts";
import { OwnerOnly } from "../refusals.ts";
import { SecretGuard, type Secret } from "../secrets.ts";
import { gone, type MemberRefusal } from "./errors.ts";
import type { HistoryFx } from "./history.ts";
import type { ImagesFx } from "./images.ts";
import type { InfoFx } from "./info.ts";
import type { KeysFx } from "./keys.ts";
import type { LiveFx } from "./live.ts";
import type { MembersFx } from "./members.ts";
import { callRelay, type CallInit, type Relay } from "./relay.ts";
import type { RequestsFx } from "./requests.ts";
import type { SecretsFx } from "./secrets.ts";
import type { SendFx } from "./send.ts";
import type { SettingsFx } from "./settings.ts";
import type { SnapshotsFx } from "./snapshots.ts";

export interface ChannelFx extends KeysFx, InfoFx, SettingsFx, RequestsFx, MembersFx, HistoryFx, SnapshotsFx, SendFx, ImagesFx, LiveFx, GithubFx, SecretsFx {}

export class ChannelCore {
  readonly name: string;
  fx!: ChannelFx;
  rotating = false;
  private guard: SecretGuard | null = null;
  private readonly guarded = new Map<string, string>();

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

  guardWith(secrets: readonly Pick<Secret, "name" | "value">[]): void {
    const before = this.guarded.size;
    for (const s of secrets) if (!this.guarded.has(s.value)) this.guarded.set(s.value, s.name);
    if (this.guarded.size !== before) this.guard = new SecretGuard([...this.guarded].map(([value, name]) => ({ name, value })));
  }

  leak(x: unknown): string | null {
    return this.guard ? this.guard.leak(JSON.stringify(x)) : null;
  }

  ownerOnly(): Effect.Effect<void, OwnerOnly> {
    return this.isOwner ? Effect.void : Effect.fail(new OwnerOnly("only the channel owner can do that"));
  }
}
