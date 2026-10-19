import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { MemberPicture } from "@kiwi/core/protocol.ts"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "robot.svg", robotUrl: () => "robot.svg", robotFor: () => "blue" }))
const { Monogram, Pictures } = await import("./kit")

const face: MemberPicture = { mime: "image/png", data: "iVBORw0KGgo=" }
const inChannel = (props: Parameters<typeof Monogram>[0], pictures: ReadonlyMap<string, MemberPicture>) =>
  renderToStaticMarkup(createElement(Pictures.Provider, { value: pictures }, createElement(Monogram, props)))

describe("a person's face", () => {
  test("wears the picture the channel knows for them, by member name", () => {
    const out = inChannel({ name: "Ana Souza", hue: "ana" }, new Map([["ana", face]]))
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="')
    expect(out).not.toContain(">AS<")
  })
  test("without one it is their initials, and a picture passed in wins", () => {
    expect(inChannel({ name: "Ana Souza", hue: "ana" }, new Map())).toContain(">AS<")
    expect(inChannel({ name: "Jonatas", picture: face }, new Map())).toContain("data:image/png;base64,")
  })
  test("an agent keeps its character, whatever pictures there are", () => {
    const out = inChannel({ name: "atlas", hue: "atlas", agent: true }, new Map([["atlas", face]]))
    expect(out).toContain("robot.svg")
    expect(out).not.toContain("data:image/png")
  })
})
