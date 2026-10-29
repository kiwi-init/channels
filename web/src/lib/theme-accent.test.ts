import { afterEach, expect, test } from "bun:test"

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

const props = new Map<string, string>()
const dataset: Record<string, string> = {}
globalThis.document = {
  documentElement: { dataset, style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) } },
} as unknown as Document

const accent: string | null = "#007aff"
let onAccent: ((color: string | null) => void) | null = null
;(globalThis as unknown as { window: unknown }).window = {
  kiwi: { getSnapshot: () => null, onStore: () => () => {}, getAccentColor: async () => accent, onAccent: (cb: (color: string | null) => void) => ((onAccent = cb), () => {}) },
}

const { ACCENT_TINT, followAccent, setTint } = await import("@kiwi/app/theme.ts")

afterEach(() => {
  store.clear()
  props.clear()
  delete dataset.tint
})

test("the System accent tint takes the accent the bridge reads, and follows it when it changes", async () => {
  followAccent()
  await Promise.resolve()
  setTint(ACCENT_TINT)
  expect(store.get("mc.tint")).toBe("accent")
  expect(props.get("--tint")).toBe("#007aff")
  expect("tint" in dataset).toBe(true)

  onAccent!("#e0383e")
  expect(props.get("--tint")).toBe("#e0383e")

  onAccent!(null)
  expect(props.has("--tint")).toBe(false)
  expect("tint" in dataset).toBe(false)
})

test("a wallpaper tint stays put when the accent changes", () => {
  followAccent()
  setTint("#336699")
  onAccent!("#e0383e")
  expect(props.get("--tint")).toBe("#336699")
})

test("anything but a hex or the accent clears the tint", () => {
  setTint("violet")
  expect(store.has("mc.tint")).toBe(false)
  expect(props.has("--tint")).toBe(false)
})
