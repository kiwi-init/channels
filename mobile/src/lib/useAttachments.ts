import { useCallback, useState } from "react"

import { MAX_ATTACHMENTS, inline, prepare, type Attachment, type Platform } from "./attachments"
import { toast } from "../ui/Toast"

export interface AttachmentsOptions {
  platform: Platform
  onProblem?: (message: string) => void
}

function failure(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useAttachments({ platform, onProblem = (m) => toast(m, "error") }: AttachmentsOptions) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)

  const pick = useCallback(async () => {
    if (attachments.length >= MAX_ATTACHMENTS) return
    setBusy(true)
    try {
      const picked = await platform.pick(MAX_ATTACHMENTS - attachments.length)
      const { added, problems } = await prepare(picked, attachments.length, platform)
      setAttachments((now) => [...now, ...added].slice(0, MAX_ATTACHMENTS))
      for (const message of problems) onProblem(message)
    } catch (err) {
      onProblem(`Couldn’t attach: ${failure(err)}`)
    } finally {
      setBusy(false)
    }
  }, [attachments.length, platform, onProblem])

  const remove = useCallback((id: string) => setAttachments((now) => now.filter((a) => a.id !== id)), [])
  const clear = useCallback(() => setAttachments([]), [])
  const files = useCallback(() => inline(attachments, platform), [attachments, platform])

  return { attachments, busy, pick, remove, clear, files }
}
