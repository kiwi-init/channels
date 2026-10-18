import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { RoomChips } from "./room-chips"

const rooms = [
  { id: "general", name: "general" },
  { id: "design", name: "design" },
]
const html = (value: string) => renderToStaticMarkup(createElement(RoomChips, { rooms, value, onChange: () => {} }))

describe("the room chips", () => {
  test("one chip per room, and only the picked one is pressed", () => {
    const out = html("design")
    expect(out).toContain("#general")
    expect(out).toContain("#design")
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(out.indexOf('aria-pressed="true"')).toBeGreaterThan(out.indexOf("#general"))
  })
})
