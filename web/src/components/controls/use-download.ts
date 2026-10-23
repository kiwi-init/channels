import { useState } from "react"

import { memberName } from "@/lib/format"
import { exportNote, logFileName, transcript, type ExportKind } from "@/lib/log-export"
import { errorText, toast } from "../kit"
import type { ControlsProps } from "./context"

export function useDownload(p: ControlsProps): { saving: ExportKind | null; download: (kind: ExportKind) => Promise<void> } {
  const [saving, setSaving] = useState<ExportKind | null>(null)
  const download = async (kind: ExportKind) => {
    setSaving(kind)
    try {
      const log = await p.exportLog()
      const at = new Date()
      const text = kind === "log" ? log.text : transcript({ title: p.title, log, nameOf: (from) => memberName(p.state.members.get(from), from), at })
      const url = URL.createObjectURL(new Blob([text], { type: kind === "log" ? "application/jsonl" : "text/markdown" }))
      const a = document.createElement("a")
      a.href = url
      a.download = logFileName(p.title, at, kind)
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      const note = exportNote(log)
      toast(note.text, note.complete ? undefined : "error")
    } catch (err) {
      toast(`Not downloaded: ${errorText(err)}`, "error")
    } finally {
      setSaving(null)
    }
  }
  return { saving, download }
}
