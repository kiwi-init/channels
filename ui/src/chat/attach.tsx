import { useEffect, useEffectEvent, useState, type ClipboardEvent, type DragEvent as ReactDragEvent, type RefObject } from "react"

import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, RASTER_MIMES } from "@kiwi/core/protocol.ts"
import { fileDrag, takeDropped } from "@kiwi/app/dropped.ts"
import { takePasted } from "@kiwi/app/pasted.ts"
import { t } from "~/i18n/i18n"
import { Icon } from "~/kit/icons"
import type { Tone } from "~/kit/toasts"
import type { Upload } from "~/model"

const MAX_FILES = 8
export const IMAGE_TYPES = new Set<string>(RASTER_MIMES)

function imageName(file: File): string {
  if (file.name) return file.name
  const ext = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] ?? "png")
  return `pasted.${ext}`
}

const readBase64 = (file: File): Promise<string> =>
  new Promise((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      done(url.slice(url.indexOf(",") + 1))
    }
    reader.onerror = () => fail(reader.error)
    reader.readAsDataURL(file)
  })

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
    if (list.length > room) toast(t(anyFile ? "chat.attach.up.to.files" : "chat.attach.up.to", { count: MAX_FILES }))
    for (const f of list.slice(0, Math.max(0, room))) {
      const name = imageName(f)
      const image = IMAGE_TYPES.has(f.type)
      if (!image && !anyFile) {
        toast(t("chat.attach.not.image", { name }), "error")
        continue
      }
      if (!image && (!f.size || f.size > MAX_FILE_BYTES)) {
        toast(t("chat.attach.too.big", { name }), "error")
        continue
      }
      if (image && f.size > MAX_IMAGE_BYTES) {
        track(
          import("@kiwi/app/compress-image.ts").then(({ compressImage, renamed }) =>
            compressImage(f, MAX_IMAGE_BYTES).then((done) => (done ? add({ ...done, name: renamed(name, done.mime) }) : toast(t("chat.attach.unreadable", { name }), "error")))
          )
        )
        continue
      }
      track(
        readBase64(f).then(
          (data) => add({ name, mime: f.type || "application/octet-stream", data }),
          () => toast(t("chat.attach.unreadable", { name }), "error")
        )
      )
    }
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

export function DropHint({ anyFile = false }: { anyFile?: boolean }) {
  return (
    <div className="compose-drop" aria-hidden="true">
      {t(anyFile ? "chat.attach.drop.files" : "chat.attach.drop")}
    </div>
  )
}

export function AttachedFiles({ files, onRemove, anyFile = false }: { files: readonly Upload[]; onRemove: (i: number) => void; anyFile?: boolean }) {
  if (!files.length) return null
  return (
    <ul className="compose-files" aria-label={t(anyFile ? "chat.attach.attached.files" : "chat.attach.attached")}>
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="compose-file">
          {f.mime.startsWith("image/") ? <img src={`data:${f.mime};base64,${f.data}`} alt={f.name} /> : <span className="compose-file-name">{f.name}</span>}
          <button type="button" className="compose-file-x" aria-label={t("chat.attach.remove.name", { name: f.name })} title={t("chat.attach.remove")} onClick={() => onRemove(i)}>
            <Icon name="close" size={12} />
          </button>
        </li>
      ))}
    </ul>
  )
}
