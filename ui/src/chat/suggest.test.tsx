import { describe, expect, test } from "bun:test"
import { useRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { Suggestions, useSuggest, type Suggest } from "~/chat/suggest"
import type { Channel, Person, Spec, Task } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { CommentBox } from "~/specs/comment-box"
import { wrote } from "~/words"

const NOW = 1_800_000_000_000
const person = (name: string, display: string, kind: "agent" | "human" = "agent"): Person => ({
  name,
  kind,
  display,
  owner: false,
  you: false,
  presence: "online",
  lastSeen: NOW,
  joined: NOW,
  messages: 0,
})

const task: Task = {
  id: 7,
  title: wrote("Export the board"),
  status: "todo",
  createdBy: "jow",
  createdAt: NOW,
  updatedAt: NOW,
  notes: [],
  rounds: [],
  history: [],
  archived: false,
}

const channel = {
  code: "c",
  you: "jow",
  people: [person("gentle-otter", "opus-coder"), person("maya", "maya", "human")],
  former: [],
  nicknames: new Map([["gentle-otter", "opus-coder"]]),
  messages: [],
  tasks: [task],
} as unknown as Channel

const spec: Spec = {
  ask: 10,
  title: wrote("Export the board"),
  words: wrote("board as a spreadsheet"),
  by: "jow",
  at: NOW,
  text: wrote("# Export the board"),
  v: 1,
  edited: { by: "jow", at: NOW },
  edits: 0,
  editors: [],
  stage: "draft",
  backs: [],
  tasks: [],
}

function probe(text: string): { html: string; s: Suggest; typed: string[] } {
  const out = { s: null as Suggest | null, typed: [] as string[] }
  function Probe() {
    const area = useRef<HTMLTextAreaElement>(null)
    const s = useSuggest({ channel, id: "probe", text, area, onText: (value) => void out.typed.push(value) })
    out.s = s
    return <Suggestions channel={channel} s={s} />
  }
  const html = renderToStaticMarkup(<Probe />)
  return { html, s: out.s!, typed: out.typed }
}

const press = (key: string) => ({ key, preventDefault: () => {}, stopPropagation: () => {} })

describe("one suggestion list for the chat composer and spec comments (#1888)", () => {
  test("@ and a nickname's first letters list the matching people", () => {
    const { html, s } = probe("see @opus")
    expect(html).toContain('aria-label="People"')
    expect(html).toContain("opus-coder")
    expect(html).not.toContain("maya")
    expect(s.count).toBe(1)
  })

  test("Enter completes the picked person by the name the box shows", () => {
    globalThis.requestAnimationFrame ??= (() => 0) as typeof requestAnimationFrame
    const { s, typed } = probe("see @op")
    expect(s.keys(press("Enter"))).toBe(true)
    expect(typed).toEqual(["see @opus-coder "])
  })

  test("a completed nickname goes out as the handle, so it mentions as in chat", () => {
    const { s } = probe("")
    expect(s.sent("@opus-coder have a look")).toBe("@gentle-otter have a look")
  })

  test("# lists tasks, and a key with nothing listed is left to the box", () => {
    const { html } = probe("blocked by #exp")
    expect(html).toContain('aria-label="Tasks"')
    expect(html).toContain("T7")
    expect(probe("plain words").s.keys(press("Enter"))).toBe(false)
  })

  test("the spec comment box is wired to the list", () => {
    const html = renderToStaticMarkup(
      <AppContext.Provider value={{ app: { channel, prefs: { enterSends: true } }, go: () => {} } as unknown as Ctx}>
        <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
          <CommentBox channel={channel} spec={spec} />
        </ActContext.Provider>
      </AppContext.Provider>
    )
    expect(html).toContain('aria-autocomplete="list"')
  })
})
