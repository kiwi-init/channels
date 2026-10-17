export function avatarIndex(key: string, count: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return count > 0 ? (h >>> 0) % count : 0
}
