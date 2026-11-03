import { expect, test } from "bun:test"
import { Ghostty } from "ghostty-web"

const wasm = new URL("../../node_modules/ghostty-web/dist/ghostty-vt.wasm", import.meta.url)

async function ghostty(): Promise<Ghostty> {
  const { instance } = await WebAssembly.instantiate(await Bun.file(wasm).arrayBuffer(), { env: { log: () => {} } })
  return new Ghostty(instance)
}

const redraw = (cols: number): string => {
  let out = "\x1b[2J\x1b[3J\x1b[H"
  for (let i = 0; i < 4000; i++) out += `\x1b[38;5;${i % 200}m${"⏺ redraw ".repeat(Math.ceil(cols / 9)).slice(0, cols)}\x1b[0m\r\n`
  return out
}

test("the terminal engine survives a full-screen app redrawing after every resize (T297)", async () => {
  const t = (await ghostty()).createTerminal(117, 30, { scrollbackLimit: 3_000 })
  try {
    for (const [cols, rows] of [
      [117, 30],
      [117, 40],
      [117, 22],
      [91, 28],
      [46, 18],
      [34, 12],
      [23, 8],
      [117, 30],
      [45, 6],
      [135, 44],
      [64, 20],
    ] as const) {
      t.resize(cols, rows)
      const out = redraw(cols)
      for (let i = 0; i < 20; i++) t.write(out.slice((i * out.length) / 20, ((i + 1) * out.length) / 20))
      t.update()
      expect([t.cols, t.rows]).toEqual([cols, rows])
      const cells = t.getViewport().slice(0, cols * rows)
      expect(cells.every((c) => c.codepoint >= 0 && c.codepoint <= 0x10ffff)).toBe(true)
      t.markClean()
    }
  } finally {
    t.free()
  }
})
