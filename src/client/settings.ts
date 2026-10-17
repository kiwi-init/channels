import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { open, seal } from "../crypto.ts";
import { omit } from "../omit.ts";
import { sign, verify } from "../identity.ts";
import { MAX_CHARTER, MAX_ROOM_NAME, ROOM_ID_RE } from "../protocol.ts";
import { MissingKey } from "../refusals.ts";
import type { GuardFloor } from "../state.ts";
import type { ChannelCore } from "./core.ts";
import type { Refusal, Refused } from "./errors.ts";
import type { ChannelInfo, Info } from "./info.ts";
import type { Relay } from "./relay.ts";

interface RoomEntry {
  id: string;
  name: string;
}

export interface RoomsSetting {
  list: RoomEntry[];
  since: number;
}

export interface ModeSetting {
  coordinatorOnly: boolean;
  strict: boolean;
  since: number;
}

export interface SettingsFx {
  mode(): Effect.Effect<ModeSetting | null, Refusal, Relay>;
  rooms(info?: Info): Effect.Effect<RoomsSetting | null, Refusal, Relay>;
  setMode(mode: ModeSetting): Effect.Effect<void, Refused, Relay>;
  setRooms(rooms: RoomsSetting): Effect.Effect<void, Refused, Relay>;
  guard(info?: Info): Effect.Effect<GuardFloor | null, Refusal, Relay>;
  setCharter(charter: NonNullable<GuardFloor["charter"]>): Effect.Effect<void, Refused, Relay>;
  setHold(hold: NonNullable<GuardFloor["hold"]>): Effect.Effect<void, Refused, Relay>;
  compress(): Effect.Effect<boolean, Refusal, Relay>;
  setCompress(on: boolean): Effect.Effect<void, Refused, Relay>;
  imageRefs(): Effect.Effect<boolean, Refusal, Relay>;
  setImageRefs(on: boolean): Effect.Effect<void, Refused, Relay>;
  startCoordinated(): Effect.Effect<void, Refused, Relay>;
}

export class ChannelSettings {
  packs = false;
  private readonly settingsWrites = Semaphore.makeUnsafe(1);

  constructor(
    private readonly ch: ChannelCore,
    private readonly info: ChannelInfo,
  ) {}

  readonly fx: SettingsFx = {
    mode: Effect.fn("Channel.mode")({ self: this }, function* (this: ChannelSettings) {
      const o = yield* this.settings();
      if (!o || typeof o.coordinatorOnly !== "boolean" || typeof o.strict !== "boolean" || !Number.isInteger(o.since)) return null;
      const mode: ModeSetting = { coordinatorOnly: o.coordinatorOnly, strict: o.coordinatorOnly && o.strict, since: o.since as number };
      return mode;
    }),

    rooms: Effect.fn("Channel.rooms")({ self: this }, function* (this: ChannelSettings, info?: Info) {
      const r = (yield* this.settings(info))?.rooms as Partial<RoomsSetting> | undefined;
      if (!r || !Array.isArray(r.list) || !Number.isInteger(r.since)) return null;
      const list = r.list.filter((x): x is RoomEntry => !!x && typeof x === "object" && ROOM_ID_RE.test((x as RoomEntry).id) && typeof (x as RoomEntry).name === "string");
      const rooms: RoomsSetting = { list: list.map((x) => ({ id: x.id, name: x.name.slice(0, MAX_ROOM_NAME) })), since: r.since! };
      return rooms;
    }),

    startCoordinated: Effect.fn("Channel.startCoordinated")({ self: this }, function* (this: ChannelSettings) {
      yield* this.ch.ownerOnly();
      const ev = { op: "mode.set" as const, coordinatorOnly: true, strict: true };
      const since = yield* this.ch.fx.send("coordinator-only on (strict)", { kind: "event", ev });
      yield* this.putSettings({ coordinatorOnly: true, strict: true, since });
    }),

    setMode: Effect.fn("Channel.setMode")({ self: this }, function* (this: ChannelSettings, mode: ModeSetting) {
      const { coordinatorOnly, strict, since } = mode;
      yield* this.putSettings({ coordinatorOnly, strict, since });
    }),

    setRooms: Effect.fn("Channel.setRooms")({ self: this }, function* (this: ChannelSettings, rooms: RoomsSetting) {
      yield* this.putSettings({ rooms });
    }),

    guard: Effect.fn("Channel.guard")({ self: this }, function* (this: ChannelSettings, info?: Info) {
      const o = yield* this.settings(info);
      if (!o) return null;
      const c = o.charter as { text?: unknown; since?: unknown } | undefined;
      const h = o.hold as { on?: unknown; note?: unknown; since?: unknown } | undefined;
      const charter = c && (c.text === null || typeof c.text === "string") && Number.isInteger(c.since) ? { text: c.text === null ? null : (c.text as string).slice(0, MAX_CHARTER), since: c.since as number } : null;
      const hold = h && typeof h.on === "boolean" && Number.isInteger(h.since) ? { on: h.on, ...(typeof h.note === "string" ? { note: h.note.slice(0, 500) } : {}), since: h.since as number } : null;
      const floor: GuardFloor | null = charter || hold ? { charter, hold } : null;
      return floor;
    }),

    setCharter: Effect.fn("Channel.setCharter")({ self: this }, function* (this: ChannelSettings, charter: NonNullable<GuardFloor["charter"]>) {
      yield* this.putSettings({ charter });
    }),

    setHold: Effect.fn("Channel.setHold")({ self: this }, function* (this: ChannelSettings, hold: NonNullable<GuardFloor["hold"]>) {
      yield* this.putSettings({ hold });
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
  };

  settings(info?: Info): Effect.Effect<Record<string, unknown> | null, Refusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const s = (info ?? (yield* this.ch.fx.info())).settings;
      const key = this.ch.access.keys["0"];
      if (!s || !key) return null;
      const o = (yield* Effect.promise(() => open(key, this.ch.roomId, s.iv, s.ct).catch(() => null))) as ({ what?: unknown; room?: unknown; pk?: string; sig?: string } & Record<string, unknown>) | null;
      if (!o || o.what !== "channel-settings" || o.room !== this.ch.roomId || o.pk !== this.ch.access.ownerPk || !(yield* Effect.promise(() => verify(o as never)))) return null;
      this.packs = o.compress === true;
      return o;
    });
  }

  private putSettings(change: Record<string, unknown>): Effect.Effect<void, Refused, Relay> {
    return Effect.gen({ self: this }, function* () {
      yield* this.ch.ownerOnly();
      const key = this.ch.access.keys["0"];
      if (!key) return yield* new MissingKey("missing the channel key");
      this.info.forgetInfo();
      const kept = omit((yield* this.settings()) ?? {}, "what", "room", "pk", "sig");
      const next = { ...kept, ...change };
      const sealed = yield* Effect.promise(async () => seal(key, this.ch.roomId, await sign(this.ch.identity, { ...next, what: "channel-settings", room: this.ch.roomId })));
      yield* this.ch.request("/settings", { method: "PUT", body: JSON.stringify({ settings: sealed }) }).pipe(Effect.ensuring(Effect.sync(() => this.info.forgetInfo())));
      this.packs = next.compress === true;
    }).pipe(Semaphore.withPermit(this.settingsWrites));
  }
}
