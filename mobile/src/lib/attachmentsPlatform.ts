import { File } from "expo-file-system"
import { ImageManipulator, SaveFormat } from "expo-image-manipulator"
import * as ImagePicker from "expo-image-picker"

import type { Platform } from "./attachments"

function nameOf(uri: string): string {
  return decodeURIComponent(uri.split("/").pop() ?? "image")
}

function mimeOf(uri: string): string {
  const ext = nameOf(uri).split(".").pop()?.toLowerCase()
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "application/octet-stream"
}

export const deviceAttachments: Platform = {
  pick: async (limit) => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: limit, quality: 1 })
    if (result.canceled) return []
    return result.assets.map((a) => ({
      uri: a.uri,
      name: a.fileName ?? nameOf(a.uri),
      mime: a.mimeType ?? mimeOf(a.uri),
      size: a.fileSize ?? new File(a.uri).size,
      width: a.width,
      height: a.height,
    }))
  },
  shrink: async (picked, width, quality) => {
    const context = ImageManipulator.manipulate(picked.uri)
    context.resize({ width })
    const image = await context.renderAsync()
    const out = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG })
    return { uri: out.uri, size: new File(out.uri).size }
  },
  readBase64: (uri) => new File(uri).base64(),
  newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
}
