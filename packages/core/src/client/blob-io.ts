import * as Effect from "effect/Effect";
import { openBlob, sealBlob } from "../crypto.ts";
import type { ChannelCore } from "./core.ts";
import { gone, RelayError, type MemberRefusal, type Refusal } from "./errors.ts";
import { Relay } from "./relay.ts";

export interface StoredBlob {
  readonly id: string;
  readonly key: string;
  readonly blob: Uint8Array<ArrayBuffer>;
}

export interface BlobRef {
  readonly id: string;
  readonly key: string;
  readonly size: number;
}

export const storeSealed = (ch: ChannelCore, raw: Uint8Array<ArrayBuffer>): Effect.Effect<StoredBlob, Refusal, Relay> =>
  Effect.gen(function* () {
    const sealed = yield* Effect.promise(() => sealBlob(raw));
    const relay = yield* Relay;
    yield* relay.blob(ch.relay, ch.roomId, sealed.id, ch.identity, sealed.blob);
    return sealed;
  });

export const fetchBlob = (ch: ChannelCore, id: string, onMissing: () => void = () => {}): Effect.Effect<Uint8Array<ArrayBuffer> | null, MemberRefusal, Relay> =>
  Effect.gen(function* () {
    const relay = yield* Relay;
    return yield* relay.blob(ch.relay, ch.roomId, id, ch.identity).pipe(
      Effect.mapError(gone),
      Effect.catchIf(
        (err) => err instanceof RelayError && err.status === 404,
        () =>
          Effect.sync(() => {
            onMissing();
            return null;
          }),
      ),
    );
  });

export const openSized = (ref: BlobRef, blob: Uint8Array<ArrayBuffer>): Effect.Effect<Uint8Array<ArrayBuffer> | null> =>
  Effect.map(
    Effect.promise(() => openBlob(ref, blob)),
    (raw) => (raw && raw.length === ref.size ? raw : null),
  );
