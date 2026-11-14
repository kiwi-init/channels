import { MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "@kiwi/core/protocol.ts"
import { IMAGE_TYPES } from "~/chat/attach"
import { t } from "~/i18n/i18n"
import type { Tone } from "~/kit/toasts"
import type { Upload } from "~/model"

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

export interface Taking {
  room: number
  most: number
  anyFile: boolean
  add: (upload: Upload) => void
  toast: (text: string, tone?: Tone) => void
  track: (job: Promise<unknown>) => void
}

export function takeFiles(list: readonly File[], { room, most, anyFile, add, toast, track }: Taking): void {
  if (list.length > room) toast(t(anyFile ? "chat.attach.up.to.files" : "chat.attach.up.to", { count: most }))
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
