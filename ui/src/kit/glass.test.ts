import { describe, expect, test } from "bun:test"
import { showGlass, showWallpaper } from "~/kit/glass"

const page = (glass?: string) => {
  const set = new Map<string, string>()
  return {
    dataset: (glass ? { glass } : {}) as DOMStringMap,
    style: { setProperty: (k: string, v: string) => void set.set(k, v), removeProperty: (k: string) => (set.delete(k), "") } as CSSStyleDeclaration,
    set,
  }
}

describe("the glass frame's mark on the page (T2107)", () => {
  test("the Mac's material is marked while the system allows it, and unmarked with Reduce transparency", () => {
    const p = page()
    showGlass(true, p)
    expect(p.dataset.glass).toBe("material")
    showGlass(false, p)
    expect(p.dataset.glass).toBeUndefined()
  })

  test("a wallpaper the desktop could read is drawn under the frame", () => {
    const p = page("image")
    showWallpaper("data:image/bmp;base64,Qk0=", p)
    expect(p.set.get("--backdrop")).toBe('url("data:image/bmp;base64,Qk0=")')
    expect(p.dataset.glass).toBe("image")
  })

  test("without a wallpaper to draw, the frame is solid again", () => {
    const p = page("image")
    showWallpaper("data:image/bmp;base64,Qk0=", p)
    showWallpaper(null, p)
    expect(p.set.has("--backdrop")).toBe(false)
    expect(p.dataset.glass).toBeUndefined()
  })
})
