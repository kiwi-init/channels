import { describe, expect, test } from "bun:test"
import { panelRoom } from "~/shell/panel-width"

describe("the details panel's width (T656)", () => {
  test("a wide window takes the width asked for, up to its cap", () => {
    expect(panelRoom(400, 1600, false)).toBe(400)
    expect(panelRoom(900, 2400, false)).toBe(760)
  })

  test("the chat keeps at least 420px beside the rail and the sidebar", () => {
    expect(panelRoom(700, 1300, false)).toBe(1300 - 64 - 248 - 420)
    expect(panelRoom(700, 1300, true)).toBe(700)
  })

  test("never narrower than the panel's own minimum", () => {
    expect(panelRoom(100, 1600, false)).toBe(320)
    expect(panelRoom(500, 900, false)).toBe(320)
  })
})
