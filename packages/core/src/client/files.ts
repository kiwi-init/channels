import * as Effect from "effect/Effect";
import { FILE_PIECE_BYTES, fileAttachment, filePieceSizes, MAX_FILE_BYTES, type FileAttachment, type FilePiece } from "../protocol.ts";
import { Rejected } from "../refusals.ts";
import { fetchBlob, openSized, storeSealed } from "./blob-io.ts";
import type { ChannelCore } from "./core.ts";
import { gone, type MemberRefusal } from "./errors.ts";
import type { Relay } from "./relay.ts";

const NO_FILES = "this channel's relay doesn't hold files yet: it needs an update";

const mb = (n: number): string => `${Math.round(n / (1024 * 1024))} MB`;

export interface FilesFx {
  putFile(name: string, mime: string, bytes: Uint8Array<ArrayBuffer>): Effect.Effect<FileAttachment, MemberRefusal | Rejected, Relay>;
  file(f: FileAttachment): Effect.Effect<Uint8Array<ArrayBuffer> | null, MemberRefusal, Relay>;
}

export class ChannelFiles {
  constructor(private readonly ch: ChannelCore) {}

  readonly fx: FilesFx = {
    putFile: Effect.fn("Channel.putFile")({ self: this }, function* (this: ChannelFiles, name: string, mime: string, bytes: Uint8Array<ArrayBuffer>) {
      if (!bytes.length) return yield* new Rejected(`${name} is empty`);
      if (bytes.length > MAX_FILE_BYTES) return yield* new Rejected(`${name} is ${mb(bytes.length)}; a file is at most ${mb(MAX_FILE_BYTES)}`);
      const info = yield* this.ch.fx.info();
      if (info.files !== true) return yield* new Rejected(NO_FILES);
      const pieces = yield* Effect.forEach(
        filePieceSizes(bytes.length),
        (size, i) =>
          Effect.gen({ self: this }, function* () {
            const at = i * FILE_PIECE_BYTES;
            const { id, key } = yield* storeSealed(this.ch, bytes.slice(at, at + size)).pipe(Effect.mapError(gone));
            const piece: FilePiece = { id, key, size };
            return piece;
          }),
        { concurrency: 4 },
      );
      const attached: FileAttachment = { name, mime: mime || "application/octet-stream", size: bytes.length, pieces };
      if (!fileAttachment(attached)) return yield* new Rejected(`${name} can't be attached: its name or type is too long`);
      return attached;
    }),

    file: Effect.fn("Channel.file")({ self: this }, function* (this: ChannelFiles, f: FileAttachment) {
      const parts = yield* Effect.forEach(f.pieces, (piece) => fetchBlob(this.ch, piece.id).pipe(Effect.flatMap((blob) => (blob ? openSized(piece, blob) : Effect.succeed(null)))), { concurrency: 4 });
      const whole = parts.filter((p): p is Uint8Array<ArrayBuffer> => p !== null);
      if (whole.length !== parts.length) return null;
      const out = new Uint8Array(f.size);
      let at = 0;
      for (const p of whole) {
        out.set(p, at);
        at += p.length;
      }
      return out;
    }),
  };
}
