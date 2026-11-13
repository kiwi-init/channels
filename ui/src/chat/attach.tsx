import { useEffect, useEffectEvent, useState, type ClipboardEvent, type DragEvent as ReactDragEvent, type RefObject } from "react"

import { RASTER_MIMES } from "@kiwi/core/protocol.ts"
import { fileDrag, takeDropped } from "@kiwi/app/dropped.ts"
import { takePasted } from "@kiwi/app/pasted.ts"
import type { Tone } from "~/kit/toasts"
import type { Upload } from "~/model"

const MAX_FILES = 8
export const IMAGE_TYPES = new Set<string>(RASTER_MIMES)

type Clip = Pick<DataTransfer, "files" | "items">

export function pastedFiles(clip: Clip, anyFile: boolean): File[] {
  const fromItems = [...clip.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file)
  return (clip.files.length ? [...clip.files] : fromItems).filter((f) => anyFile || f.type.startsWith("image/"))
}

type Toast = (text: string, tone?: Tone) => void

type Box = Pick<DOMRect, "left" | "right" | "top" | "bottom">

export function dropTarget(zones: readonly Box[], x: number, y: number): number {
  let best = -1
  let near = Infinity
  zones.forEach((r, i) => {
    if (x < r.left || x > r.right) return
    const away = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
    if (away < near) {
      near = away
      best = i
    }
  })
  return best
}

interface Zone {
  el: () => HTMLElement | null
  take: (dt: DataTransfer) => void
}

const zones = new Set<Zone>()

function onWindowDrop(e: DragEvent): void {
  if (!e.dataTransfer || !fileDrag(e.dataTransfer)) return
  e.preventDefault()
  if (e.type !== "drop") return
  const open = [...zones].flatMap((z) => {
    const el = z.el()
    return el ? [{ z, el }] : []
  })
  if (open.some(({ el }) => e.target instanceof Node && el.contains(e.target))) return
  const at = dropTarget(
    open.map(({ el }) => {
      const column = (el.closest(".panel") ?? el.closest(".main") ?? el).getBoundingClientRect()
      const own = el.getBoundingClientRect()
      return { left: column.left, right: column.right, top: own.top, bottom: own.bottom }
    }),
    e.clientX,
    e.clientY
  )
  open[at]?.z.take(e.dataTransfer)
}

function dropZoneOpen(zone: Zone): () => void {
  if (!zones.size) {
    window.addEventListener("dragover", onWindowDrop)
    window.addEventListener("drop", onWindowDrop)
  }
  zones.add(zone)
  return () => {
    zones.delete(zone)
    if (zones.size) return
    window.removeEventListener("dragover", onWindowDrop)
    window.removeEventListener("drop", onWindowDrop)
  }
}

export function useAttach({
  files,
  setFiles,
  zone,
  toast,
  anyFile = false,
  refused,
}: {
  files: readonly Upload[]
  setFiles: (next: (now: Upload[]) => Upload[]) => void
  zone: RefObject<HTMLElement | null>
  toast: Toast
  anyFile?: boolean
  refused?: () => string | null
}) {
  const [reading, setReading] = useState(0)
  const [dropping, setDropping] = useState(false)
  const add = (upload: Upload) => setFiles((now) => (now.length < MAX_FILES ? [...now, upload] : now))
  const track = (job: Promise<unknown>): void => {
    setReading((n) => n + 1)
    void job.finally(() => setReading((n) => n - 1))
  }
  const attach = (list: readonly File[]) => {
    const no = refused?.()
    if (no) return void toast(no, "error")
    const room = MAX_FILES - files.length
    track(import("~/chat/attach-files").then((m) => m.takeFiles(list, { room, most: MAX_FILES, anyFile, add, toast, track })))
  }

  const takeIn = (dt: DataTransfer) => {
    setDropping(false)
    if (dt.files.length) return attach([...dt.files])
    void takeDropped(dt).then(({ files: dropped, refused: why }) => {
      for (const w of why) toast(w, "error")
      attach(dropped)
    })
  }

  const dropped = useEffectEvent((dt: DataTransfer) => takeIn(dt))

  useEffect(() => dropZoneOpen({ el: () => zone.current, take: dropped }), [zone])

  const paste = (e: ClipboardEvent<HTMLElement>) => {
    const images = pastedFiles(e.clipboardData, anyFile)
    if (!images.length) return track(takePasted(e.clipboardData).then((f) => f && attach([f])))
    if (!e.clipboardData.getData("text/plain")) e.preventDefault()
    attach(images)
  }

  const dropZone = {
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      if (!fileDrag(e.dataTransfer)) return
      e.preventDefault()
      setDropping(true)
    },
    onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
      if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
      setDropping(false)
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      if (!fileDrag(e.dataTransfer)) return
      e.preventDefault()
      takeIn(e.dataTransfer)
    },
  }

  return { attach, paste, reading, dropping, dropZone }
}
