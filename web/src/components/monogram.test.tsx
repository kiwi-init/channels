import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { MemberPicture } from "@kiwi/core/protocol.ts"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "robot.svg", robotUrl: () => "robot.svg", robotFor: () => "blue", harnessUrl: (h: string) => `/harness/${h}.svg` }))
const { Harnesses, Monogram, Pictures } = await import("./kit")

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
})

const agentIn = (harnesses: ReadonlyMap<string, string>, name = "atlas") =>
  renderToStaticMarkup(createElement(Harnesses.Provider, { value: harnesses }, createElement(Monogram, { name: "Atlas", hue: name, agent: true })))

describe("an agent's face", () => {
  test("is its harness's logo, by member name, never a robot head or a person's picture", () => {
    const out = renderToStaticMarkup(
      createElement(
        Pictures.Provider,
        { value: new Map([["atlas", face]]) },
        createElement(Harnesses.Provider, { value: new Map([["atlas", "claude"]]) }, createElement(Monogram, { name: "Atlas", hue: "atlas", agent: true }))
      )
    )
    expect(out).toContain('src="/harness/claude-code.svg"')
    expect(out).toContain('aria-label="Claude Code"')
    expect(out).not.toContain("robot.svg")
    expect(out).not.toContain("data:image/png")
  })
  test("a one-colour logo follows the theme's ink", () => {
    const out = agentIn(new Map([["atlas", "opencode"]]))
    expect(out).toContain("bg-ink")
    expect(out).toContain("/harness/opencode.svg")
  })
  test("an unknown harness, or none said, is a plain terminal", () => {
    for (const out of [agentIn(new Map([["atlas", "my-own-loop"]])), agentIn(new Map())]) {
      expect(out).toContain('aria-label="Agent"')
      expect(out).not.toContain("/harness/")
    }
  })
})
