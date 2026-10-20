import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { omit } from "../omit.ts";
import { sign } from "../identity.ts";
import { MAX_CHARTER, MAX_ROOM_NAME, ROOM_ID_RE } from "../protocol.ts";
import { MissingKey, Rejected } from "../refusals.ts";
import { reposOf, type GuardFloor } from "../state.ts";
import type { ChannelCore } from "./core.ts";
import type { Refusal, Refused } from "./errors.ts";
import type { ChannelInfo, Info } from "./info.ts";
import type { Relay } from "./relay.ts";
import { freshInfo, newestEpoch, noteSeen, notOlder, ownerSigned, sealFor, signedAt } from "./sealed.ts";

interface RoomEntry {
  id: string;
  name: string;
}

export interface RoomsSetting {
  list: RoomEntry[];
  since: number;
}

export interface SettingsFx {
  rooms(info?: Info): Effect.Effect<RoomsSetting | null, Refusal, Relay>;
  setRooms(rooms: RoomsSetting): Effect.Effect<void, Refused, Relay>;
  guard(info?: Info): Effect.Effect<GuardFloor | null, Refusal, Relay>;
  setCharter(charter: NonNullable<GuardFloor["charter"]>): Effect.Effect<void, Refused, Relay>;
  setHold(hold: NonNullable<GuardFloor["hold"]>): Effect.Effect<void, Refused, Relay>;
  setRepos(repos: NonNullable<GuardFloor["repos"]>): Effect.Effect<void, Refused, Relay>;
  compress(): Effect.Effect<boolean, Refusal, Relay>;
  setCompress(on: boolean): Effect.Effect<void, Refused, Relay>;
  imageRefs(): Effect.Effect<boolean, Refusal, Relay>;
  setImageRefs(on: boolean): Effect.Effect<void, Refused, Relay>;
  resealSettings(): Effect.Effect<void, Refused, Relay>;
}

export class ChannelSettings {
  packs = false;
  private readonly settingsWrites = Semaphore.makeUnsafe(1);

  constructor(
    private readonly ch: ChannelCore,
    private readonly info: ChannelInfo,
  ) {}

  readonly fx: SettingsFx = {
    rooms: Effect.fn("Channel.rooms")({ self: this }, function* (this: ChannelSettings, info?: Info) {
      const r = (yield* this.settings(info))?.rooms as Partial<RoomsSetting> | undefined;
      if (!r || !Array.isArray(r.list) || !Number.isInteger(r.since)) return null;
      const list = r.list.filter((x): x is RoomEntry => !!x && typeof x === "object" && ROOM_ID_RE.test((x as RoomEntry).id) && typeof (x as RoomEntry).name === "string");
      const rooms: RoomsSetting = { list: list.map((x) => ({ id: x.id, name: x.name.slice(0, MAX_ROOM_NAME) })), since: r.since! };
      return rooms;
    }),

    setRooms: Effect.fn("Channel.setRooms")({ self: this }, function* (this: ChannelSettings, rooms: RoomsSetting) {
      yield* this.putSettings({ rooms });
    }),

    guard: Effect.fn("Channel.guard")({ self: this }, function* (this: ChannelSettings, info?: Info) {
      const o = yield* this.settings(info);
      if (!o) return null;
      const c = o.charter as { text?: unknown; since?: unknown } | undefined;
      const h = o.hold as { on?: unknown; note?: unknown; since?: unknown } | undefined;
      const charter =
        c && (c.text === null || typeof c.text === "string") && Number.isInteger(c.since)
          ? { text: c.text === null ? null : (c.text as string).slice(0, MAX_CHARTER), since: c.since as number }
          : null;
      const hold = h && typeof h.on === "boolean" && Number.isInteger(h.since) ? { on: h.on, ...(typeof h.note === "string" ? { note: h.note.slice(0, 500) } : {}), since: h.since as number } : null;
      const r = o.repos as { list?: unknown; since?: unknown } | undefined;
      const repos = r && Array.isArray(r.list) && Number.isInteger(r.since) ? { list: reposOf(r.list), since: r.since as number } : null;
      const floor: GuardFloor | null = charter || hold || repos ? { charter, hold, ...(repos ? { repos } : {}) } : null;
      return floor;
    }),

    setCharter: Effect.fn("Channel.setCharter")({ self: this }, function* (this: ChannelSettings, charter: NonNullable<GuardFloor["charter"]>) {
      yield* this.putSettings({ charter });
    }),

    setHold: Effect.fn("Channel.setHold")({ self: this }, function* (this: ChannelSettings, hold: NonNullable<GuardFloor["hold"]>) {
      yield* this.putSettings({ hold });
    }),

    setRepos: Effect.fn("Channel.setRepos")({ self: this }, function* (this: ChannelSettings, repos: NonNullable<GuardFloor["repos"]>) {
      yield* this.putSettings({ repos });
    }),

    compress: Effect.fn("Channel.compress")({ self: this }, function* (this: ChannelSettings) {
      return (yield* this.settings())?.compress === true;
    }),

    setCompress: Effect.fn("Channel.setCompress")({ self: this }, function* (this: ChannelSettings, on: boolean) {
      yield* this.putSettings({ compress: on });
    }),

    imageRefs: Effect.fn("Channel.imageRefs")({ self: this }, function* (this: ChannelSettings) {
      return (yield* this.settings())?.imageRefs === true;
    }),

    setImageRefs: Effect.fn("Channel.setImageRefs")({ self: this }, function* (this: ChannelSettings, on: boolean) {
      yield* this.putSettings({ imageRefs: on });
    }),

    resealSettings: Effect.fn("Channel.resealSettings")({ self: this }, function* (this: ChannelSettings) {
      yield* this.ch.ownerOnly();
      this.info.forgetInfo();
      const info = yield* this.ch.fx.info();
      if (!info.sealedEpoch || !info.settings || (info.settings.e ?? 0) >= newestEpoch(this.ch.access.keys)) return;
      if (yield* this.settings(info)) yield* this.putSettings({});
    }),
  };

  settings(info?: Info): Effect.Effect<Record<string, unknown> | null, Refusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const s = (info ?? (yield* this.ch.fx.info())).settings;
      if (!s) return null;
      const o = yield* ownerSigned(this.ch, s, "channel-settings");
      if (!o || !notOlder(this.ch, "seenSettingsAt", o.at)) return null;
      this.packs = o.compress === true;
      return o;
    });
  }

  private putSettings(change: Record<string, unknown>): Effect.Effect<void, Refused, Relay> {
    return Effect.gen({ self: this }, function* () {
      yield* this.ch.ownerOnly();
      const info = yield* freshInfo(this.ch, () => this.info.forgetInfo());
      const current = info.settings ? yield* ownerSigned(this.ch, info.settings, "channel-settings") : null;
      if (info.settings && !current) return yield* new MissingKey("can't open the channel's current settings, so changing one would drop the rest: try again in a moment");
      if (current && !notOlder(this.ch, "seenSettingsAt", current.at))
        return yield* new Rejected(
          "the relay is serving older settings than this device has already seen, so changing one now would bring the older ones back: that's the relay's doing; ask whoever runs it",
        );
      const kept = omit(current ?? {}, "what", "room", "pk", "sig", "at");
      const next = { ...kept, ...change };
      const at = signedAt(this.ch, "seenSettingsAt", current?.at);
      const signed = yield* Effect.promise(() => sign(this.ch.identity, { ...next, what: "channel-settings", room: this.ch.roomId, at }));
      const sealed = yield* sealFor(this.ch, info, signed);
      if (!sealed) return yield* new MissingKey("missing the channel key");
      yield* this.ch.request("/settings", { method: "PUT", body: JSON.stringify({ settings: sealed }) }).pipe(Effect.ensuring(Effect.sync(() => this.info.forgetInfo())));
      noteSeen(this.ch, "seenSettingsAt", at);
      this.packs = next.compress === true;
    }).pipe(Semaphore.withPermit(this.settingsWrites));
  }
}
