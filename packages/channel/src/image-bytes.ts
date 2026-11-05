import { fromBase64, toBase64 } from "@kiwi/core/crypto.ts";
import { omit } from "@kiwi/core/omit.ts";
import type { ImageAttachment, Message } from "@kiwi/core/protocol.ts";

const held = new WeakMap<ImageAttachment, Blob>();

function byRef(img: ImageAttachment): ImageAttachment {
  if (img.data === undefined) return img;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(img.data);
  } catch {
    // Not base64 after all: leave it inline, so the picture shows as it did.
    return img;
  }
  const kept = omit(img, "data");
  held.set(kept, new Blob([bytes], { type: img.mime }));
  return kept;
}

export function holdImages(m: Message): Message {
  if (!m.imgs?.some((i) => i.data !== undefined)) return m;
  return { ...m, imgs: m.imgs.map(byRef) };
}

export const holdAll = (messages: readonly Message[]): Message[] => messages.map(holdImages);

export function heldImage(img: ImageAttachment): Promise<string> | null {
  const blob = held.get(img);
  return blob ? blob.arrayBuffer().then((b) => toBase64(new Uint8Array(b))) : null;
}
