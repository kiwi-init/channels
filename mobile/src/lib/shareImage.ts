import type { ImageAttachment } from "@mc/protocol.ts"
import { File, Paths } from "expo-file-system"
import { Platform, Share } from "react-native"

function bytesOf(base64: string): Uint8Array {
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function shareImage(img: ImageAttachment): Promise<void> {
  if (!img.data) return
  const file = new File(Paths.cache, img.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "image")
  file.create({ overwrite: true })
  file.write(bytesOf(img.data))
  await Share.share(Platform.OS === "ios" ? { url: file.uri } : { message: file.uri })
}
