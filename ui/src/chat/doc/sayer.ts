export type Say = (text: string, reply: { re: number; quote: string | null } | null, back: (text: string) => void) => boolean

const sayers = new Map<string, Say>()

export function letSay(key: string, say: Say): () => void {
  sayers.set(key, say)
  return () => void sayers.delete(key)
}

export const sayerAt = (key: string): Say | null => sayers.get(key) ?? null
