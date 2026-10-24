import type { KiwiBridge } from "../../../desktop/src/bridge.ts"
import { bridge } from "./secrets"

type Paste = Pick<DataTransfer, "types" | "files" | "getData">

export const emptyPaste = (d: Paste): boolean => !d.files.length && !d.types.length && !d.getData("text/plain") && !d.getData("text/html")

export async function takePasted(d: Paste, b: KiwiBridge | null = bridge(), agent = navigator.userAgent): Promise<File | null> {
  if (!b || !/Linux/.test(agent) || !emptyPaste(d)) return null
  const got = await b.takePastedImage().catch(() => null)
  if (!got) return null
  return new File([Uint8Array.from(atob(got.data), (c) => c.charCodeAt(0))], "pasted.png", { type: got.type })
}
