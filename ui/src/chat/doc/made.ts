export interface MadeLines {
  has: (block: string) => boolean
  add: (block: string) => unknown
}

export const madeHere: MadeLines = new Set<string>()
