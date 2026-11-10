import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { InlineText, linksIn, PartView } from "~/chat/inline-text"
import QuestionCard from "~/chat/question-card"
import type { Channel, QuestionAsk, Task } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { wrote } from "~/words"

const task: Task = { id: 7, title: wrote("Export"), status: "doing", createdBy: "jow", createdAt: 0, updatedAt: 0, notes: [], rounds: [], history: [], archived: false }

const channel = {
  code: "c",
  title: "c",
  youOwn: true,
  you: "jow",
  repos: [],
  rooms: [],
  directs: [],
  theirs: [],
  people: [],
  nicknames: new Map([["gentle-otter", "opus-coder"]]),
  messages: [],
  tasks: [task],
  asks: [],
  connection: "live",
} as unknown as Channel

const wrap = (node: React.ReactNode): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>{node}</ActContext.Provider>
    </AppContext.Provider>
  )

const ask = (more: Partial<QuestionAsk>): QuestionAsk => ({
  kind: "question",
  id: "40",
  from: "gentle-otter",
  at: 0,
  text: wrote("Authorize T7 steps 1-3? See #12"),
  label: "Intent check for you",
  options: [],
  holds: [],
  ...more,
})

describe("task ids, #refs, URLs and mentions in cards are links (#1828)", () => {
  test("an ask's text links T7 and #12, and names agents by nickname", () => {
    const html = wrap(<InlineText text="Authorize T7 steps 1-3? See #12, asked by @gentle-otter: https://example.com/plan" channel={channel} before={40} />)
    expect(html).toContain('class="inline-ref" title="Open the task">T7</button>')
    expect(html).toContain('title="Show the message">#12</button>')
    expect(html).toContain('href="https://example.com/plan"')
    expect(html).toContain("@opus-coder")
    expect(html).not.toContain("gentle-otter")
  })

  test("a task id that isn't on the board stays text", () => {
    expect(wrap(<InlineText text="see T99" channel={channel} before={40} />)).not.toContain("inline-ref")
  })

  test("clicking T7 opens the task panel and stops there, so the card isn't answered", () => {
    const part = linksIn("Ship T7 now", channel.nicknames, 40)[0]
    if (!part) throw new Error("no link found for T7")
    const went: unknown[] = []
    const onClick: unknown = PartView({ part, channel, go: (to) => void went.push(to) }).props.onClick
    if (typeof onClick !== "function") throw new Error("T7 has no click handler")
    let stopped = false
    onClick({ stopPropagation: () => (stopped = true) })
    expect(went).toEqual([{ to: "task", task: 7 }])
    expect(stopped).toBe(true)
  })

  test("a link in an option sits beside the option's button, not inside it", () => {
    const html = wrap(<QuestionCard channel={channel} ask={ask({ options: [wrote("A: Ship T7 now"), wrote("B: Not yet")] })} />)
    const option = html.match(/<button type="button" class="ask-option">.*?<\/button>/)?.[0] ?? ""
    expect(option).toContain("A: Ship T7 now")
    expect(option).not.toContain("inline-ref")
    expect(html).toContain('<span class="ask-option-refs"><button type="button" class="inline-ref" title="Open the task">T7</button></span>')
  })

  test("a step's why, instructions and expected result link their task ids", () => {
    const html = wrap(<QuestionCard channel={channel} ask={ask({ step: { why: "T7 needs a signed tag", needsPerson: "jow", do: ["Read T7 first"], expect: "T7 shows signed" } })} />)
    expect(html.match(/class="inline-ref" title="Open the task">T7<\/button>/g)?.length).toBe(3)
  })
})
