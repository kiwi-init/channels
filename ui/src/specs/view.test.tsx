import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Person, Spec, Task } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { maker } from "~/panes/page"
import { SpecCard } from "~/specs/card"
import { SpecFaces, specsLook, specsText } from "~/specs/view"
import { wrote } from "~/words"

const NOW = 1_800_000_000_000
const person = (name: string, display: string): Person => ({
  name,
  kind: "agent",
  display,
  owner: false,
  you: false,
  presence: "online",
  lastSeen: NOW,
  joined: NOW,
  messages: 0,
  harness: "astra",
  face: "coder",
})

const owned = (id: number, owner: string): Task => ({
  id,
  title: wrote("Build it"),
  status: "doing",
  owner,
  createdBy: "jow",
  createdAt: NOW,
  updatedAt: NOW,
  notes: [],
  rounds: [],
  history: [],
  archived: false,
})

const spec: Spec = {
  ask: 10,
  title: wrote("Export the board"),
  words: wrote("board as a spreadsheet"),
  by: "jow",
  at: NOW,
  text: wrote("# Export the board\n\n## Done when\n- [ ] a button"),
  v: 1,
  edited: { by: "jow", at: NOW },
  edits: 0,
  editors: [],
  stage: "working",
  backs: [],
  tasks: [7, 8],
}

const channelOf = (people: Person[], nicknames: [string, string][], tasks: Task[]): Channel =>
  ({
    code: "c",
    title: "c",
    youOwn: true,
    you: "jow",
    repos: [],
    rooms: [],
    directs: [],
    theirs: [],
    people,
    nicknames: new Map(nicknames),
    messages: [],
    tasks,
    asks: [],
    specs: [spec],
    connection: "live",
  }) as unknown as Channel

const renderList = (channel: Channel): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <SpecFaces channel={channel} spec={spec} />
    </AppContext.Provider>
  )
const renderCard = (channel: Channel): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <SpecCard channel={channel} spec={spec} />
      </ActContext.Provider>
    </AppContext.Provider>
  )

const element = (html: string, tag: string, at: number): string => {
  const open = `<${tag}`
  const close = `</${tag}>`
  let depth = 0
  let i = at
  while (i < html.length) {
    const nextOpen = html.indexOf(open, i)
    const nextClose = html.indexOf(close, i)
    if (nextClose < 0) return html.slice(at)
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++
      i = nextOpen + open.length
    } else {
      depth--
      i = nextClose + close.length
      if (depth === 0) return html.slice(at, i)
    }
  }
  return html.slice(at)
}

const opened = (html: string, tag: string, mark: string): number => html.lastIndexOf(`<${tag}`, html.indexOf(mark))
const faces = (html: string): string => element(html, "span", opened(html, "span", 'class="spec-card-faces'))
const cardButton = (html: string): string => element(html, "button", opened(html, "button", 'class="spec-card-main'))

const list = (channel: Channel, on: number | null = null): string =>
  specsText(channel, { shown: "open", pages: 1, on, now: NOW }, { show: () => {}, page: () => {}, make: () => {} }, maker("t")).replace(/\\(.)/g, "$1")

describe("worker names on Specs avatars (#2335)", () => {
  test("a row's single worker avatar carries their name", () => {
    const html = renderList(channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "opus-coder"]], [owned(7, "gentle-otter")]))
    const box = faces(html)
    expect(box).toContain('class="spec-face"')
    expect(box).toContain(">opus-coder</span>")
    expect(box).not.toContain("gentle-otter")
  })

  test("two workers with the same face keep their own names", () => {
    const html = renderList(
      channelOf(
        [person("gentle-otter", "opus-coder"), person("quiet-heron", "ds-reviewer")],
        [
          ["gentle-otter", "opus-coder"],
          ["quiet-heron", "ds-reviewer"],
        ],
        [owned(7, "gentle-otter"), owned(8, "quiet-heron")]
      )
    )
    const box = faces(html)
    expect(box.match(/class="spec-face"/g)?.length).toBe(2)
    expect(box).toContain(">opus-coder</span>")
    expect(box).toContain(">ds-reviewer</span>")
  })

  test("a renamed worker's label follows the current nickname", () => {
    const html = renderList(channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "quiet-otter"]], [owned(7, "gentle-otter")]))
    const box = faces(html)
    expect(box).toContain(">quiet-otter</span>")
    expect(box).not.toContain("opus-coder")
  })

  test("a card's worker avatars carry names too", () => {
    const html = renderCard(channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "opus-coder"]], [owned(7, "gentle-otter")]))
    const box = faces(html)
    expect(box).toContain('class="spec-face"')
    expect(box).toContain(">opus-coder</span>")
  })

  test("the row is one link, and its faces hold no focusables", () => {
    const channel = channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "opus-coder"]], [owned(7, "gentle-otter"), owned(8, "gentle-otter")])
    const md = list(channel)
    expect(md.match(/kiwi-page:spec:10:inside/g)?.length).toBe(1)
    const faces = renderList(channel)
    expect(faces).not.toContain("<button")
    expect(faces).not.toContain("<a ")
    expect(faces).not.toContain("tabindex")
  })

  test("the card stays one button with no focusables inside", () => {
    const html = renderCard(channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "opus-coder"]], [owned(7, "gentle-otter")]))
    const card = cardButton(html)
    expect(card.slice(card.indexOf(">") + 1)).not.toContain("<button")
    expect(card).not.toContain("tabindex")
  })
})

describe("the Specs list is a markdown page, nothing lost (T4532)", () => {
  const two = () => channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "opus-coder"]], [owned(7, "gentle-otter"), { ...owned(8, "gentle-otter"), status: "waiting" }])

  test("a spec's open tasks fold under it, unfolded while one of them waits on you", () => {
    const md = list(two())
    expect(md).toContain("## [Working](<kiwi-do:?tone=doing>) · 1")
    expect(md).toMatch(/\[Export the board\]\(<kiwi-page:spec:10:inside>\) · 0\/2 tasks `kiwi:open`/)
    expect(md).toMatch(/\n {2}- \[Build it\]\(<kiwi-task:7>\)\\\n {4}\[T7\]/)
  })

  test("with nothing waiting the tasks start folded", () => {
    const channel = channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "opus-coder"]], [owned(7, "gentle-otter"), owned(8, "gentle-otter")])
    expect(list(channel)).toContain("0/2 tasks `kiwi:fold`")
    expect(list(channel, 8)).toContain("0/2 tasks `kiwi:open`")
  })

  test("a task line keeps its number, its state, its PR and its mentions", () => {
    const channel = channelOf(
      [person("gentle-otter", "opus-coder")],
      [["gentle-otter", "opus-coder"]],
      [owned(7, "gentle-otter"), { ...owned(8, "gentle-otter"), pr: { repo: "o/r", number: 45, title: "x", state: "open", checks: "fail", url: "https://github.com/o/r/pull/45" }, mentions: 2 }]
    )
    const md = list(channel)
    expect(md).toContain("[T8](<kiwi-do:>)")
    expect(md).toContain("[PR #45](<kiwi-do:?tip=Checks+failed&tone=alert>)")
    expect(md).toContain("`kiwi:n:2`")
  })

  test("a spec title can't draw an act or a heading", () => {
    const sly = { ...spec, title: wrote("# Boom [go](kiwi-do:run)") }
    const channel = { ...two(), specs: [sly] } as Channel
    const md = specsText(channel, { shown: "open", pages: 1, on: null, now: NOW }, { show: () => {}, page: () => {}, make: () => {} }, maker("t"))
    expect(md).not.toContain("kiwi-do:run")
    expect(md).not.toMatch(/^# Boom/m)
  })

  test("the open task is marked on the page, and spec rows get their mark and faces", () => {
    const channel = two()
    const look = specsLook(channel, 7)
    expect(look.on?.("kiwi-task:7")).toBe(true)
    expect(look.on?.("kiwi-task:8")).toBe(false)
    expect(look.lead?.("kiwi-page:spec:10:inside")).toBeDefined()
    expect(look.lead?.("kiwi-task:7")).toBeUndefined()
    expect(look.drag?.("kiwi-page:spec:10:inside")).toBeDefined()
    expect(look.fold?.("kiwi-page:spec:10:inside", false)).toMatch(/^Show the \d+ open tasks? of \S/)
    expect(look.fold?.("kiwi-page:spec:10:inside", true)).toMatch(/^Hide the \d+ open tasks? of \S/)
    expect(look.fold?.("kiwi-task:7", false)).toBeUndefined()
  })
})
