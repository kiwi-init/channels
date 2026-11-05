import type { Upload } from "~/model"

export type Say = (text: string, reply: { re: number; quote: string | null } | null, back: (text: string, files: readonly Upload[]) => void, files: readonly Upload[]) => boolean

const sayers = new Map<string, Say>()

export function letSay(key: string, say: Say): () => void {
  sayers.set(key, say)
  return () => void sayers.delete(key)
}

export const sayerAt = (key: string): Say | null => sayers.get(key) ?? null
