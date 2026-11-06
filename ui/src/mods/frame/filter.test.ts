import { expect, test } from "bun:test"

import { filtered } from "~/mods/frame/filter"

const sections = [
  { title: "Open", items: [{ title: "Fix the login", subtitle: "KIW-12", keywords: ["auth"] }, { title: "Ship mods" }] },
  { title: "Done", items: [{ title: "Login page copy" }] },
]

test("a list's search keeps the items that have every word, in title, subtitle or keywords, and drops empty sections", () => {
  expect(filtered(sections, "")).toBe(sections)
  expect(filtered(sections, "  LOGIN ")).toEqual([
    { title: "Open", items: [sections[0]!.items[0]!] },
    { title: "Done", items: [sections[1]!.items[0]!] },
  ])
  expect(filtered(sections, "login kiw-12")).toEqual([{ title: "Open", items: [sections[0]!.items[0]!] }])
  expect(filtered(sections, "auth fix")).toEqual([{ title: "Open", items: [sections[0]!.items[0]!] }])
  expect(filtered(sections, "nothing like it")).toEqual([])
})
