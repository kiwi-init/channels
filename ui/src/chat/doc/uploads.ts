const pending = new Map<string, number>()
const waiting = new Map<string, (() => void)[]>()

export const uploading = (block: string): boolean => (pending.get(block) ?? 0) > 0

export function startUpload(block: string): () => void {
  pending.set(block, (pending.get(block) ?? 0) + 1)
  let done = false
  return () => {
    if (done) return
    done = true
    const left = (pending.get(block) ?? 1) - 1
    if (left > 0) return void pending.set(block, left)
    pending.delete(block)
    const then = waiting.get(block) ?? []
    waiting.delete(block)
    for (const f of then) f()
  }
}

export function afterUploads(block: string, then: () => void): boolean {
  if (!uploading(block)) return false
  waiting.set(block, [...(waiting.get(block) ?? []), then])
  return true
}
