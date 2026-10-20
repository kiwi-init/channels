import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AnswerMemory, BlobMemory, RecordMemory } from "@kiwi/core/client.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import type { Identity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { SigningBudget } from "@kiwi/core/sas.ts";
import type { FoldBase } from "@kiwi/core/state.ts";
import { appendCache, dropBase, fileAnswerMemory, fileBlobMemory, fileRecordMemory, keepBase, readBase, readCache, replaceCache, trimCache } from "./cache.ts";
import { markSeen, readCursor, readSeen, writeCursor } from "./cursors.ts";
import { loadConfig, saveAccess, updateConfig, type Config } from "./file.ts";
import { forgetIdentities, forgetIdentity, identitiesIn, loadIdentity, saveIdentity } from "./identities.ts";
import { signingBudget } from "./paths.ts";
import { forgetMember, wipeChannel } from "./wipe.ts";

export interface KeystoreApi {
  readonly config: Effect.Effect<Config>;
  readonly update: (change: (cfg: Config) => void) => Effect.Effect<Config>;
  readonly identity: (name: string, roomId: string) => Effect.Effect<Identity>;
  readonly identitiesIn: (roomId: string) => Effect.Effect<string[]>;
  readonly forgetIdentity: (name: string, roomId: string) => Effect.Effect<void>;
  readonly saveIdentity: (id: Identity, roomId: string) => Effect.Effect<void>;
  readonly forgetIdentities: (roomId: string) => Effect.Effect<void>;
  readonly saveAccess: (alias: string, access: ChannelAccess) => Effect.Effect<void>;
  readonly forgetMember: (alias: string, name: string) => Effect.Effect<void>;
  readonly wipeChannel: (alias: string) => Effect.Effect<void>;
  readonly budget: SigningBudget;
  readonly records: RecordMemory;
  readonly answers?: AnswerMemory;
  readonly blobs: BlobMemory;
}

export class Keystore extends Context.Service<Keystore, KeystoreApi>()("kiwi/Keystore") {}

export class Cache extends Context.Service<
  Cache,
  {
    readonly read: (roomId: string) => Effect.Effect<Message[]>;
    readonly append: (roomId: string, messages: Message[]) => Effect.Effect<void>;
    readonly replace: (roomId: string, messages: Message[]) => Effect.Effect<void>;
    readonly base: (roomId: string) => Effect.Effect<FoldBase | null>;
    readonly keepBase: (roomId: string, base: FoldBase) => Effect.Effect<void>;
    readonly dropBase: (roomId: string) => Effect.Effect<void>;
    readonly trim: (roomId: string, base: FoldBase) => Effect.Effect<void>;
  }
>()("kiwi/Cache") {}

export class Cursor extends Context.Service<
  Cursor,
  {
    readonly read: (channel: string, agent: string) => Effect.Effect<number | null>;
    readonly write: (channel: string, agent: string, seq: number) => Effect.Effect<void>;
    readonly seen: (channel: string, agent: string) => Effect.Effect<Set<number>>;
    readonly markSeen: (channel: string, agent: string, seqs: number[]) => Effect.Effect<void>;
  }
>()("kiwi/Cursor") {}

const fileKeystore: KeystoreApi = {
  config: Effect.sync(loadConfig),
  update: (change) => Effect.sync(() => updateConfig(change)),
  identity: (name, roomId) => Effect.promise(() => loadIdentity(name, roomId)),
  identitiesIn: (roomId) => Effect.sync(() => identitiesIn(roomId)),
  forgetIdentity: (name, roomId) => Effect.sync(() => forgetIdentity(name, roomId)),
  saveIdentity: (id, roomId) => Effect.sync(() => saveIdentity(id, roomId)),
  forgetIdentities: (roomId) => Effect.sync(() => forgetIdentities(roomId)),
  saveAccess: (alias, access) => Effect.sync(() => saveAccess(alias, access)),
  forgetMember: (alias, name) => Effect.sync(() => forgetMember(alias, name)),
  wipeChannel: (alias) => Effect.sync(() => wipeChannel(alias)),
  budget: signingBudget,
  records: fileRecordMemory,
  answers: fileAnswerMemory,
  blobs: fileBlobMemory,
};

export const LocalFiles: Layer.Layer<Keystore | Cache | Cursor> = Layer.mergeAll(
  Layer.succeed(Keystore, fileKeystore),
  Layer.succeed(Cache, {
    read: (roomId) => Effect.sync(() => readCache(roomId)),
    append: (roomId, messages) => Effect.sync(() => appendCache(roomId, messages)),
    replace: (roomId, messages) => Effect.sync(() => replaceCache(roomId, messages)),
    base: (roomId) => Effect.sync(() => readBase(roomId)),
    keepBase: (roomId, base) => Effect.sync(() => keepBase(roomId, base)),
    dropBase: (roomId) => Effect.sync(() => dropBase(roomId)),
    trim: (roomId, base) => Effect.sync(() => void trimCache(roomId, base)),
  }),
  Layer.succeed(Cursor, {
    read: (channel, agent) => Effect.sync(() => readCursor(channel, agent)),
    write: (channel, agent, seq) => Effect.sync(() => writeCursor(channel, agent, seq)),
    seen: (channel, agent) => Effect.sync(() => readSeen(channel, agent)),
    markSeen: (channel, agent, seqs) => Effect.sync(() => markSeen(channel, agent, seqs)),
  }),
);
