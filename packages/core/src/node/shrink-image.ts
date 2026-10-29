import { FLOORS, fitImage } from "../fit-image.ts";

export interface Shrunk {
  mime: "image/webp";
  bytes: Uint8Array;
}

export async function shrinkImage(input: Uint8Array, limit: number): Promise<Shrunk> {
  const { width, height } = await new Bun.Image(input).metadata();
  const fit = await fitImage(width, height, limit, FLOORS["image/webp"], async (shot) => {
    const side = Math.max(shot.width, shot.height);
    const bytes = await new Bun.Image(input)
      .resize(side, side, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: Math.max(1, Math.round(shot.quality * 100)) })
      .bytes();
    return { size: bytes.length, bytes };
  });
  return { mime: "image/webp", bytes: fit.bytes };
}
