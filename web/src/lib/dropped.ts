import type { DroppedFile, KiwiBridge } from "../../../desktop/src/bridge.ts"
import { bridge } from "./secrets"

type Drag = Pick<DataTransfer, "types" | "getData">

const dropsAsUris = (b: KiwiBridge | null, agent: string): b is KiwiBridge => b !== null && /Linux/.test(agent)

export const fileDrag = (dt: Pick<DataTransfer, "types">, b: KiwiBridge | null = bridge(), agent = navigator.userAgent): boolean =>
  dt.types.includes("Files") || (dropsAsUris(b, agent) && dt.types.includes("text/uri-list"))

export function asFiles(got: readonly DroppedFile[]): { files: File[]; refused: string[] } {
  const files: File[] = []
  const refused: string[] = []
  for (const f of got) {
    if ("refused" in f) refused.push(f.refused)
    else files.push(new File([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], f.name, { type: f.type }))
  }
  return { files, refused }
}

export async function takeDropped(dt: Drag, b: KiwiBridge | null = bridge(), agent = navigator.userAgent): Promise<{ files: File[]; refused: string[] }> {
  const local = dt
    .getData("text/uri-list")
    .split(/\r?\n/)
    .some((u) => u.startsWith("file:"))
  if (!local || !dropsAsUris(b, agent)) return { files: [], refused: [] }
  return asFiles(await b.takeDroppedFiles())
}
