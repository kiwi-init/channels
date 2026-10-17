import * as Effect from "effect/Effect";
import { fromBase64, openBlob, sealBlob, toBase64 } from "../crypto.ts";
import type { ImageAttachment, InlineImage } from "../protocol.ts";
import type { ChannelCore } from "./core.ts";
import { gone, RelayError, type MemberRefusal } from "./errors.ts";
import { Relay } from "./relay.ts";
import type { ChannelSettings } from "./settings.ts";

export interface ImagesFx {
  image(img: ImageAttachment): Effect.Effect<string | null, MemberRefusal, Relay>;
  images(imgs: readonly ImageAttachment[]): Effect.Effect<InlineImage[], MemberRefusal, Relay>;
}

export class ChannelImages {
  constructor(
    private readonly ch: ChannelCore,
    private readonly settings: ChannelSettings,
  ) {}

  readonly fx: ImagesFx = {
    image: Effect.fn("Channel.image")({ self: this }, function* (this: ChannelImages, img: ImageAttachment) {
      if (img.data !== undefined) return img.data;
      const ref = img.ref;
      if (!ref) return null;
      const cached = blobMemory.get(this.ch.roomId, ref.id);
      const kept = cached ? yield* Effect.promise(() => openBlob(ref, cached)) : null;
      if (kept && kept.length === ref.size) return toBase64(kept);
      const relay = yield* Relay;
      const blob = yield* relay.blob(this.ch.relay, this.ch.roomId, ref.id, this.ch.identity).pipe(
        Effect.mapError(gone),
        Effect.catchIf(
          (err) => err instanceof RelayError && err.status === 404,
          () =>
            Effect.sync(() => {
              blobMemory.drop(this.ch.roomId, ref.id);
              return null;
            }),
        ),
      );
      if (!blob) return null;
      const raw = yield* Effect.promise(() => openBlob(ref, blob));
      if (!raw || raw.length !== ref.size) return null;
      blobMemory.set(this.ch.roomId, ref.id, blob);
      return toBase64(raw);
    }),

    images: Effect.fn("Channel.images")({ self: this }, function* (this: ChannelImages, imgs: readonly ImageAttachment[]) {
      const data = yield* Effect.forEach(imgs, (img) => this.ch.fx.image(img), { concurrency: 4 });
      return imgs.flatMap((img, i): InlineImage[] => {
        const d = data[i];
        return d == null ? [] : [{ name: img.name, mime: img.mime, data: d }];
      });
    }),
  };

  stored(imgs: ImageAttachment[]): Effect.Effect<ImageAttachment[], never, Relay> {
    return Effect.gen({ self: this }, function* () {
      if (!imgs.some((i) => i.data !== undefined)) return imgs;
      const info = yield* Effect.option(this.ch.fx.info());
      if (info._tag === "None" || info.value.blobs !== true) return imgs;
      const settings = yield* Effect.option(this.settings.settings(info.value));
      if (settings._tag === "None" || settings.value?.imageRefs !== true) return imgs;
      const relay = yield* Relay;
      return yield* Effect.forEach(
        imgs,
        (img) =>
          Effect.gen({ self: this }, function* () {
            if (img.data === undefined) return img;
            const raw = fromBase64(img.data);
            const { id, key, blob } = yield* Effect.promise(() => sealBlob(raw));
            yield* relay.blob(this.ch.relay, this.ch.roomId, id, this.ch.identity, blob);
            blobMemory.set(this.ch.roomId, id, blob);
            const ref: ImageAttachment = { name: img.name, mime: img.mime, ref: { id, key, size: raw.length } };
            return ref;
          }).pipe(Effect.orElseSucceed(() => img)),
        { concurrency: 4 },
      );
    });
  }
}

export interface BlobMemory {
  get(room: string, id: string): Uint8Array<ArrayBuffer> | null;
  set(room: string, id: string, blob: Uint8Array<ArrayBuffer>): void;
  drop(room: string, id: string): void;
}
const blobsInProcess = new Map<string, Uint8Array<ArrayBuffer>>();
let blobMemory: BlobMemory = {
  get: (_room, id) => blobsInProcess.get(id) ?? null,
  set: (_room, id, blob) => {
    blobsInProcess.delete(id);
    blobsInProcess.set(id, blob);
    while (blobsInProcess.size > 64) blobsInProcess.delete(blobsInProcess.keys().next().value!);
  },
  drop: (_room, id) => void blobsInProcess.delete(id),
};
export function keepBlobsIn(memory: BlobMemory): void {
  blobMemory = memory;
}
