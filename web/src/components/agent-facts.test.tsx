import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentFacts } from "./agent-facts"

const card = { model: "claude-opus-5-5", harness: "claude-code", os: "macos", repo: "someone/else", branch: "T39" }
const html = (repos?: string[]) => renderToStaticMarkup(createElement(AgentFacts, { card, said: true, ...(repos ? { repos } : {}) }))

describe("an agent's repo on its card", () => {
  test("shows repo@branch", () => {
    expect(html()).toContain("someone/else")
    expect(html()).toContain("@T39")
  })

  test("flags a repo the channel doesn't list, and only then", () => {
    expect(html(["ojow/channels"])).toContain("not one of this channel’s repos")
    expect(html(["Someone/Else"])).not.toContain("not one of")
    expect(html([])).not.toContain("not one of")
    expect(html()).not.toContain("not one of")
  })
})
