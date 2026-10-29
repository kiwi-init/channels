import * as Effect from "effect/Effect";
import { fromBase64, openBlob, sealBlob, toBase64 } from "../crypto.ts";
import { blobRef, type ImageAttachment, type InlineImage, type RasterMime } from "../protocol.ts";
import type { ChannelCore } from "./core.ts";
import { gone, RelayError, type MemberRefusal } from "./errors.ts";
import { Relay } from "./relay.ts";
import type { ChannelSettings } from "./settings.ts";

export interface ImagesFx {
  image(img: ImageAttachment): Effect.Effect<string | null, MemberRefusal, Relay>;
  images(imgs: readonly ImageAttachment[]): Effect.Effect<InlineImage[], MemberRefusal, Relay>;
}

/** An image to send: inline as it is, or, with `full`, the full-size bytes go as a blob and `data` rides along as the preview. */
export type OutgoingImage = ImageAttachment & { full?: { mime: RasterMime; data: string } };

const inline = ({ name, mime, data, ref }: OutgoingImage): ImageAttachment => ({ name, mime, ...(data !== undefined ? { data } : {}), ...(ref ? { ref } : {}) });

export class ChannelImages {
  constructor(
    private readonly ch: ChannelCore,
    private readonly settings: ChannelSettings,
  ) {}

  readonly fx: ImagesFx = {
    image: Effect.fn("Channel.image")({ self: this }, function* (this: ChannelImages, img: ImageAttachment) {
      return (yield* this.best(img))?.data ?? null;
    }),

    images: Effect.fn("Channel.images")({ self: this }, function* (this: ChannelImages, imgs: readonly ImageAttachment[]) {
      const got = yield* Effect.forEach(imgs, (img) => this.best(img), { concurrency: 4 });
      return imgs.flatMap((img, i): InlineImage[] => {
        const g = got[i];
        return g ? [{ name: img.name, ...g }] : [];
      });
    }),
  };

  private best(img: ImageAttachment): Effect.Effect<{ mime: string; data: string } | null, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
      const preview = img.data !== undefined ? { mime: img.mime, data: img.data } : null;
      const ref = blobRef(img);
      if (!ref) return preview;
      const full = yield* this.blob(ref).pipe(
        Effect.catchIf(
          () => preview !== null,
          () => Effect.succeed(null),
        ),
      );
      return full !== null ? { mime: ref.mime ?? img.mime, data: full } : preview;
    });
  }

  private blob(ref: { id: string; key: string; size: number }): Effect.Effect<string | null, MemberRefusal, Relay> {
    return Effect.gen({ self: this }, function* () {
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
    });
  }

  stored(imgs: OutgoingImage[]): Effect.Effect<ImageAttachment[], never, Relay> {
    return Effect.gen({ self: this }, function* () {
      if (!imgs.some((i) => i.data !== undefined)) return imgs.map(inline);
      const info = yield* Effect.option(this.ch.fx.info());
      if (info._tag === "None" || info.value.blobs !== true) return imgs.map(inline);
      const settings = imgs.every((i) => i.full) ? null : yield* Effect.option(this.settings.settings(info.value));
      const byRef = settings?._tag === "Some" && settings.value?.imageRefs === true;
      const relay = yield* Relay;
      const upload = (raw: Uint8Array<ArrayBuffer>) =>
        Effect.gen({ self: this }, function* () {
          const { id, key, blob } = yield* Effect.promise(() => sealBlob(raw));
          yield* relay.blob(this.ch.relay, this.ch.roomId, id, this.ch.identity, blob);
          blobMemory.set(this.ch.roomId, id, blob);
          return { id, key, size: raw.length };
        });
      return yield* Effect.forEach(
        imgs,
        (img): Effect.Effect<ImageAttachment, never, Relay> => {
          const full = img.full;
          if (full)
            return upload(fromBase64(full.data)).pipe(
              Effect.map((ref): ImageAttachment => ({ ...inline(img), ref: { ...ref, ...(full.mime !== img.mime ? { mime: full.mime } : {}) } })),
              Effect.orElseSucceed(() => inline(img)),
            );
          if (!byRef || img.data === undefined) return Effect.succeed(inline(img));
          return upload(fromBase64(img.data)).pipe(
            Effect.map((ref): ImageAttachment => ({ name: img.name, mime: img.mime, ref })),
            Effect.orElseSucceed(() => inline(img)),
          );
        },
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
