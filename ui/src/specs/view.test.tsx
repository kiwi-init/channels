import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Person, Spec, Task } from "~/model"
import { ActContext, AppContext, NavContext, type Act, type Ctx, type Nav } from "~/nav"
import { SpecCard } from "~/specs/card"
import { SpecsView } from "~/specs/view"
import { wrote } from "~/words"

const NOW = 1_800_000_000_000
const person = (name: string, display: string): Person => ({ name, kind: "agent", display, owner: false, you: false, presence: "online", lastSeen: NOW, joined: NOW, messages: 0, harness: "astra", face: "coder" })

const owned = (id: number, owner: string): Task => ({ id, title: wrote("Build it"), status: "doing", owner, createdBy: "jow", createdAt: NOW, updatedAt: NOW, notes: [], rounds: [], history: [], archived: false })

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
  ({ code: "c", title: "c", youOwn: true, you: "jow", repos: [], rooms: [], directs: [], theirs: [], people, nicknames: new Map(nicknames), messages: [], tasks, asks: [], specs: [spec], connection: "live" } as unknown as Channel)

const providers = (channel: Channel) => (
  <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
    <NavContext.Provider value={{} as Nav}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <SpecsView channel={channel} />
      </ActContext.Provider>
    </NavContext.Provider>
  </AppContext.Provider>
)

const renderList = (channel: Channel): string => renderToStaticMarkup(providers(channel))
const renderCard = (channel: Channel): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <SpecCard channel={channel} spec={spec} />
      </ActContext.Provider>
    </AppContext.Provider>,
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
const rowButton = (html: string): string => element(html, "button", opened(html, "button", 'class="gh-row spec-row'))
const cardButton = (html: string): string => element(html, "button", opened(html, "button", 'class="spec-card-main'))

describe("worker names on Specs avatars (#2335)", () => {
  test("a row's single worker avatar carries their name", () => {
    const html = renderList(channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "opus-coder"]], [owned(7, "gentle-otter")]))
    const box = faces(html)
    expect(box).toContain('class="spec-face"')
    expect(box).toContain(">opus-coder</span>")
    expect(box).not.toContain("gentle-otter")
  })

  test("two workers with the same face keep their own names", () => {
    const html = renderList(channelOf([person("gentle-otter", "opus-coder"), person("quiet-heron", "ds-reviewer")], [["gentle-otter", "opus-coder"], ["quiet-heron", "ds-reviewer"]], [owned(7, "gentle-otter"), owned(8, "quiet-heron")]))
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

  test("the row stays one button with no focusables inside", () => {
    const html = renderList(channelOf([person("gentle-otter", "opus-coder"), person("quiet-heron", "ds-reviewer")], [["gentle-otter", "opus-coder"], ["quiet-heron", "ds-reviewer"]], [owned(7, "gentle-otter"), owned(8, "quiet-heron")]))
    const row = rowButton(html)
    expect(row.slice(row.indexOf(">") + 1)).not.toContain("<button")
    expect(row).not.toContain("tabindex")
  })

  test("the card stays one button with no focusables inside", () => {
    const html = renderCard(channelOf([person("gentle-otter", "opus-coder")], [["gentle-otter", "opus-coder"]], [owned(7, "gentle-otter")]))
    const card = cardButton(html)
    expect(card.slice(card.indexOf(">") + 1)).not.toContain("<button")
    expect(card).not.toContain("tabindex")
  })
})
