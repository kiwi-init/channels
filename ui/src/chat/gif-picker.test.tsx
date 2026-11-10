import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import Gifs from "~/chat/gif-picker"

describe("a message row's GIF tool is not an app context reader (T2444)", () => {
  test("it renders with no app context around it, so an app change can't re-render it", () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, "location")
    Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "http:", origin: "http://127.0.0.1:1" } })
    try {
      expect(renderToStaticMarkup(<Gifs open={false} onReady={() => {}} onClose={() => {}} onFile={() => {}} />)).toBe("")
    } finally {
      if (before) Object.defineProperty(globalThis, "location", before)
      else Reflect.deleteProperty(globalThis, "location")
    }
  })
})
