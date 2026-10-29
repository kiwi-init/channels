import type { DroppedFile, KiwiBridge } from "../../../desktop/src/bridge.ts";
import { bridge } from "@kiwi/secrets/secrets.ts";

const here = (): string => `${navigator.platform} ${navigator.userAgent}`;

const dropsAsUris = (b: KiwiBridge | null, where: string): b is KiwiBridge => b !== null && /Linux/.test(where);

export const fileDrag = (dt: Pick<DataTransfer, "types">, b: KiwiBridge | null = bridge(), where = here()): boolean =>
  dt.types.includes("Files") || (dropsAsUris(b, where) && dt.types.includes("text/uri-list"));

export function asFiles(got: readonly DroppedFile[]): { files: File[]; refused: string[] } {
  const files: File[] = [];
  const refused: string[] = [];
  for (const f of got) {
    if ("refused" in f) refused.push(f.refused);
    else files.push(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
  }
  return { files, refused };
}

export async function takeDropped(dt: Pick<DataTransfer, "types">, b: KiwiBridge | null = bridge(), where = here()): Promise<{ files: File[]; refused: string[] }> {
  if (!dropsAsUris(b, where) || !dt.types.includes("text/uri-list")) return { files: [], refused: [] };
  return asFiles(await b.takeDroppedFiles());
}
