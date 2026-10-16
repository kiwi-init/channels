import { render, screen } from "@testing-library/react-native"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { avatarIndex } from "./avatarIndex"
import { RobotAvatar } from "./RobotAvatar"
import { robots } from "./robots"

const dir = join(__dirname, "../../../assets/avatars")

describe("robots", () => {
  it("are exactly the SVG files in assets/avatars, in name order", () => {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".svg"))
      .sort()
    expect(robots).toHaveLength(files.length)
    expect(robots).toEqual(files.map((f) => readFileSync(join(dir, f), "utf8")))
  })

  it("are all well-formed SVG documents", () => {
    for (const xml of robots) {
      expect(xml.startsWith("<svg ")).toBe(true)
      expect(xml.endsWith("</svg>")).toBe(true)
    }
  })
})

describe("avatarIndex", () => {
  it("is stable, inside the set, and the same function the web uses", () => {
    expect(avatarIndex("otter-gentle", 12)).toBe(avatarIndex("otter-gentle", 12))
    expect(avatarIndex("anything", 0)).toBe(0)
    const names = ["kiwi-sh", "merge-bus", "kiwi-browser", "deepseek-one", "deepseek-two", "claude-3", "otter-gentle", "heron-calm"]
    for (const n of names) expect(avatarIndex(n, 12)).toBeLessThan(12)
    expect(names.map((n) => avatarIndex(n, 12))).toEqual([7, 4, 8, 2, 8, 11, 1, 11])
    expect(new Set(names.map((n) => avatarIndex(n, 12))).size).toBeGreaterThanOrEqual(5)
  })
})

describe("RobotAvatar", () => {
  it("draws a robot, labelled when asked", async () => {
    await render(<RobotAvatar name="kiwi-sh" size={40} label="The coordinator" />)
    expect(screen.getByLabelText("The coordinator")).toBeTruthy()
  })
})
