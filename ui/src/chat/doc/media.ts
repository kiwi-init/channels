import { RASTER_MIMES } from "@kiwi/core/protocol.ts"
import type { BlockMedia } from "@kiwi/core/doc/blocks.ts"
import type { Node } from "prosemirror-model"
import type { NodeView } from "prosemirror-view"

import { bytesOf, sizeText } from "~/chat/doc/bytes"
import { fileOf, imageOf } from "~/chat/doc/schema"
import { t } from "~/i18n/i18n"
import type { DocFile, DocImage, Upload } from "~/model"

export interface DocMedia {
  putImage(upload: Upload): Promise<DocImage>
  putFile(upload: Upload): Promise<DocFile>
  image(img: DocImage): Promise<string | null>
  file(f: DocFile): Promise<string | null>
}

const RASTER = new Set<string>(RASTER_MIMES)

export const putAll = (files: readonly Upload[], media: DocMedia): Promise<BlockMedia[]> =>
  Promise.all(files.map(async (u): Promise<BlockMedia> => (RASTER.has(u.mime) ? { image: await media.putImage(u) } : { file: await media.putFile(u) })))

export function filesIn(dt: DataTransfer | null): File[] {
  if (!dt) return []
  if (dt.files.length) return [...dt.files]
  return [...dt.items].flatMap((item) => {
    const f = item.kind === "file" ? item.getAsFile() : null
    return f ? [f] : []
  })
}

export function imageView(media: () => DocMedia | null, open: (url: string, alt: string) => void): (node: Node) => NodeView {
  return (node) => {
    const img = imageOf(node)
    const dom = document.createElement("figure")
    dom.className = "doc-image is-loading"
    dom.contentEditable = "false"
    dom.dataset.image = img.name
    const spot = document.createElement("span")
    spot.className = "doc-image-spot"
    spot.textContent = img.name
    dom.append(spot)
    let live = true
    let letGo: (() => void) | null = null
    const lost = (why: string) => {
      if (!live) return
      dom.className = "doc-image is-gone"
      spot.textContent = why
    }
    const load = () => {
      const m = media()
      if (!m) return
      void m
        .image(img)
        .then(
          async (data) => {
            if (!live) return
            if (data === null) return lost(t("chat.doc.media.gone", { name: img.name }))
            const url = `data:${img.mime};base64,${data}`
            const { DOC_BOX, keyOf, scaleFor, thumbs } = await import("~/chat/thumbs")
            if (!live) return
            const scale = scaleFor(window.devicePixelRatio)
            const key = keyOf(img.ref.id, DOC_BOX, scale)
            letGo = () => thumbs.free(key)
            const shot = await thumbs.take(key, url, DOC_BOX, scale)
            if (!live) return
            const pic = document.createElement("img")
            pic.alt = img.name
            pic.width = shot.width
            pic.height = shot.height
            pic.src = shot.thumb ?? url
            pic.draggable = false
            pic.addEventListener("click", () => open(url, img.name))
            dom.className = "doc-image"
            dom.replaceChildren(pic)
          },
          () => lost(`${img.name} didn't load`)
        )
        .catch(() => lost(`${img.name} didn't load`))
    }
    load()
    return {
      dom,
      ignoreMutation: () => true,
      stopEvent: (e) => e.type === "click",
      destroy: () => {
        live = false
        letGo?.()
      },
    }
  }
}

export function fileView(media: () => DocMedia | null): (node: Node) => NodeView {
  return (node) => {
    const f = fileOf(node)
    const name = String(node.attrs.name ?? "")
    const dom = document.createElement("div")
    dom.className = "doc-file"
    dom.contentEditable = "false"
    dom.dataset.file = name
    const button = document.createElement("button")
    button.type = "button"
    button.className = "doc-file-chip"
    const label = document.createElement("span")
    label.className = "doc-file-name"
    label.textContent = name
    const size = document.createElement("span")
    size.className = "doc-file-size"
    size.textContent = sizeText(Number(node.attrs.size) || 0)
    button.append(label, size)
    button.disabled = !f
    button.setAttribute("aria-label", t("chat.doc.media.download", { name }))
    button.addEventListener("click", () => {
      const m = media()
      if (!m || !f) return
      button.disabled = true
      void m
        .file(f)
        .then((data) => {
          if (data === null) {
            size.textContent = t("chat.doc.media.no.longer")
            return
          }
          const url = URL.createObjectURL(new Blob([bytesOf(data)], { type: f.mime || "application/octet-stream" }))
          const a = document.createElement("a")
          a.href = url
          a.download = f.name || "file"
          a.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
        })
        .catch(() => {
          size.textContent = t("chat.doc.media.no.download")
        })
        .finally(() => {
          button.disabled = false
        })
    })
    dom.append(button)
    return { dom, ignoreMutation: () => true, stopEvent: (e) => e.type === "click" || e.type === "mousedown" }
  }
}
