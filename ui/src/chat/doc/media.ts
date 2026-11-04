import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, RASTER_MIMES } from "@kiwi/core/protocol.ts"
import type { Node } from "prosemirror-model"
import type { NodeView } from "prosemirror-view"

import { bytesOf, sizeText } from "~/chat/doc/bytes"
import { fileNode, fileOf, imageNode, imageOf } from "~/chat/doc/schema"
import type { DocFile, DocImage, Upload } from "~/model"

export interface DocMedia {
  putImage(upload: Upload): Promise<DocImage>
  putFile(upload: Upload): Promise<DocFile>
  image(img: DocImage): Promise<string | null>
  file(f: DocFile): Promise<string | null>
}

const RASTER = new Set<string>(RASTER_MIMES)
const AT_ONCE = 8

function pastedName(file: File): string {
  if (file.name) return file.name
  const ext = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] ?? "bin")
  return `pasted.${ext}`
}

const readBase64 = (blob: Blob): Promise<string> => import("@kiwi/app/compress-image.ts").then((m) => m.readBase64(blob))

async function imageUpload(file: File, name: string): Promise<Upload> {
  if (file.size <= MAX_IMAGE_BYTES) return { name, mime: file.type, data: await readBase64(file) }
  const { compressImage, renamed } = await import("@kiwi/app/compress-image.ts")
  const done = await compressImage(file, MAX_IMAGE_BYTES)
  if (!done) throw new Error(`${name} couldn't be read`)
  return { ...done, name: renamed(name, done.mime) }
}

export async function uploadAll(files: readonly File[], media: DocMedia, refused: (why: string) => void): Promise<Node[]> {
  if (files.length > AT_ONCE) refused(`Up to ${AT_ONCE} at once; the rest were left out`)
  const done = await Promise.all(
    files.slice(0, AT_ONCE).map(async (file): Promise<Node | null> => {
      const name = pastedName(file)
      try {
        if (RASTER.has(file.type)) return imageNode(await media.putImage(await imageUpload(file, name)))
        if (file.size === 0) throw new Error(`${name} is empty`)
        if (file.size > MAX_FILE_BYTES) throw new Error(`${name} is ${sizeText(file.size)}; a file is at most ${sizeText(MAX_FILE_BYTES)}`)
        return fileNode(await media.putFile({ name, mime: file.type || "application/octet-stream", data: await readBase64(file) }))
      } catch (e) {
        refused(e instanceof Error && e.message ? e.message : `${name} couldn't be added`)
        return null
      }
    })
  )
  return done.filter((n): n is Node => n !== null)
}

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
    const load = () => {
      const m = media()
      if (!m) return
      void m.image(img).then(
        (data) => {
          if (!live) return
          if (data === null) {
            dom.className = "doc-image is-gone"
            spot.textContent = `${img.name} is no longer available`
            return
          }
          const url = `data:${img.mime};base64,${data}`
          const pic = document.createElement("img")
          pic.alt = img.name
          pic.src = url
          pic.draggable = false
          pic.addEventListener("click", () => open(url, img.name))
          dom.className = "doc-image"
          dom.replaceChildren(pic)
        },
        () => {
          if (!live) return
          dom.className = "doc-image is-gone"
          spot.textContent = `${img.name} didn't load`
        }
      )
    }
    load()
    return {
      dom,
      ignoreMutation: () => true,
      stopEvent: (e) => e.type === "click",
      destroy: () => {
        live = false
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
    button.setAttribute("aria-label", `Download ${name}`)
    button.addEventListener("click", () => {
      const m = media()
      if (!m || !f) return
      button.disabled = true
      void m
        .file(f)
        .then((data) => {
          if (data === null) {
            size.textContent = "no longer available"
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
          size.textContent = "didn't download"
        })
        .finally(() => {
          button.disabled = false
        })
    })
    dom.append(button)
    return { dom, ignoreMutation: () => true, stopEvent: (e) => e.type === "click" || e.type === "mousedown" }
  }
}
