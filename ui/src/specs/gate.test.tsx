import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Person, Spec } from "~/model"
import { ActContext, AppContext, NavContext, type Act, type Ctx, type Nav } from "~/nav"
import { SpecCard } from "~/specs/card"
import { SpecPage } from "~/specs/page"
import { specsText } from "~/specs/view"
import { maker } from "~/panes/page"
import { wrote } from "~/words"

const NOW = 1_800_000_000_000
const person = (name: string, kind: Person["kind"]): Person => ({ name, kind, owner: false, you: false, presence: "online", lastSeen: NOW, joined: NOW, messages: 0 })

const draft = (more: Partial<Spec> = {}): Spec => ({
  ask: 10,
  title: wrote("Export the board"),
  words: wrote("board as a spreadsheet"),
  by: "jow",
  at: NOW,
  text: wrote("# Export the board\n\n## Done when\n- [ ] a button"),
  v: 14,
  edited: { by: "atlas", at: NOW },
  edits: 2,
  editors: ["atlas"],
  stage: "draft",
  backs: [],
  comments: [],
  tasks: [],
  canJudge: true,
  ...more,
})

const channelOf = (spec: Spec): Channel =>
  ({
    code: "c",
    title: "c",
    youOwn: true,
    you: "jow",
    repos: [],
    rooms: [],
    directs: [],
    theirs: [],
    people: [person("jow", "human"), person("atlas", "agent"), person("win", "agent")],
    nicknames: new Map([["atlas", "coder-one"]]),
    messages: [],
    tasks: [],
    asks: [],
    specs: [spec],
    free: ["win"],
    connection: "live",
  }) as unknown as Channel

const page = (spec: Spec): string => {
  const channel = channelOf(spec)
  return renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <NavContext.Provider value={{ part: "inside" } as unknown as Nav}>
        <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
          <SpecPage channel={channel} spec={spec} />
        </ActContext.Provider>
      </NavContext.Provider>
    </AppContext.Provider>
  )
}

const gate = (html: string): string => html.slice(html.indexOf('class="spec-gate'), html.indexOf("</div></div>", html.indexOf('class="spec-gate')))

const card = (spec: Spec): string => {
  const channel = channelOf(spec)
  return renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <SpecCard channel={channel} spec={spec} />
      </ActContext.Provider>
    </AppContext.Provider>
  )
}

const list = (spec: Spec): string => specsText(channelOf(spec), { shown: "open", pages: 1, on: null, now: NOW }, { show: () => {}, page: () => {}, make: () => {} }, maker("t")).replace(/\\(.)/g, "$1")

describe("a draft asks for approval only once it's marked ready (#2489)", () => {
  test("a draft nobody marked ready says so, with a quiet Approve anyway and no primary Approve", () => {
    const html = gate(page(draft()))
    expect(html).toContain("Draft, not marked ready yet.")
    expect(html).toContain("Its writers and reviewers are still on it.")
    expect(html).toContain('class="btn is-quiet"')
    expect(html).toContain("Approve anyway")
    expect(html).not.toContain("is-primary")
    expect(html).not.toContain("Approve it and it starts when an agent is free.")
    expect(list(draft())).toContain("## [Drafts]")
    expect(list(draft())).not.toContain("Needs you")
    expect(card(draft())).toContain("not marked ready yet")
    expect(card(draft())).not.toContain("waits for your approval")
  })

  test("a ready draft names who marked which version ready, beside the primary Approve", () => {
    const ready = draft({ ready: { by: "atlas", at: NOW, v: 14 } })
    const html = gate(page(ready))
    expect(html).toContain("Approve it and it starts when an agent is free.")
    expect(html).toContain("Marked ready by coder-one at version 14")
    expect(html).toContain("1 free now")
    expect(html).toContain('class="btn is-primary"')
    expect(html).not.toContain("Approve anyway")
    expect(list(ready)).toContain("## [Needs you]")
    expect(card(ready)).toContain("waits for your approval")
  })

  test("someone who doesn't judge it sees it isn't ready yet, and no button", () => {
    const html = gate(page(draft({ canJudge: undefined })))
    expect(html).toContain("Draft, not marked ready yet.")
    expect(html).not.toContain("<button")
    expect(gate(page(draft({ canJudge: undefined, ready: { by: "atlas", at: NOW, v: 14 } })))).toContain("Waiting for jow to approve it.")
  })
})
