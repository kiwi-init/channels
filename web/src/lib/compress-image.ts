import { FLOORS, fitImage, type LossyMime } from "@kiwi/core/fit-image.ts"

import type { KiwiBridge } from "../../../desktop/src/bridge.ts"
import { bridge } from "./secrets"

interface Compressed {
  mime: string
  data: string
}

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void

export function renamed(name: string, mime: string): string {
  const ext = mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "png")
  const dot = name.lastIndexOf(".")
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`
}

function encode(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}

let lossy: Promise<LossyMime> | null = null

function lossyMime(): Promise<LossyMime> {
  lossy ??= (async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const blob = await encode(canvas, "image/webp", 0.8)
    return blob?.type === "image/webp" ? "image/webp" : "image/jpeg"
  })()
  return lossy
}

export function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(url.slice(url.indexOf(",") + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error("the image couldn't be read"))
    reader.readAsDataURL(blob)
  })
}

async function fitCanvas(width: number, height: number, limit: number, draw: Draw): Promise<Compressed> {
  const mime = await lossyMime()
  const canvas = document.createElement("canvas")
  const blob = await fitImage(width, height, limit, FLOORS[mime], async (shot) => {
    if (canvas.width !== shot.width || canvas.height !== shot.height) {
      canvas.width = shot.width
      canvas.height = shot.height
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      if (mime === "image/jpeg") {
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, shot.width, shot.height)
      }
      draw(ctx, shot.width, shot.height)
    }
    const got = await encode(canvas, mime, shot.quality)
    return got && got.type === mime ? got : null
  })
  return { mime, data: await readBase64(blob) }
}

async function viaApp(b: KiwiBridge, file: Blob, limit: number): Promise<Compressed | null> {
  if (!("compressImage" in b)) return null
  const got = await b.compressImage(await readBase64(file), limit).catch(() => null)
  return got ? { mime: got.type, data: got.data } : null
}

export async function compressImage(file: Blob, limit: number, b: KiwiBridge | null = bridge()): Promise<Compressed | null> {
  const app = b ? await viaApp(b, file, limit) : null
  if (app) return app
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return null
  try {
    return await fitCanvas(bitmap.width, bitmap.height, limit, (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height))
  } finally {
    bitmap.close()
  }
}
