import { bridge } from "@kiwi/secrets/secrets.ts"

import { daylight, type Rgb } from "~/afk/daylight"

export type Backdrop = { kind: "meadow" } | { kind: "scene"; html: string } | { kind: "plain" }

export const AFK_FRAME_URL = "views://internal/afk-frame.html"

export const READY_MS = 8_000

const css = (c: Rgb): string => `rgb(${c.map((v) => Math.round(v * 255)).join(" ")})`

export function plainSky(at: Date): string {
  const { top, low, haze } = daylight(at).look
  return `linear-gradient(${css(top)}, ${css(low)} 70%, ${css(haze)})`
}

export async function afkBackdrop(): Promise<Backdrop> {
  const b = bridge()
  if (typeof b?.afkScene !== "function") return { kind: "meadow" }
  const got = await b.afkScene()
  if (got === null) return { kind: "meadow" }
  if (got.html !== null) return { kind: "scene", html: got.html }
  if (!got.first || typeof b.keepAfkScene !== "function") return { kind: "plain" }
  const made = await fetch(new URL("afk-scene.html", location.href))
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null)
  const kept = made === null ? null : await b.keepAfkScene(made)
  return kept === null ? { kind: "meadow" } : { kind: "scene", html: kept }
}
