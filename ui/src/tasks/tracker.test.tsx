import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { showActivity } from "~/chat/activity"
import type { Channel, Message, Task } from "~/model"
import { AppContext, type Ctx } from "~/nav"
import { Tracker } from "~/tasks/tracker"
import { wrote } from "~/words"

const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
let saved: string | null = null

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: { getItem: () => saved, setItem: () => {} } })
})

afterEach(() => {
  saved = null
  showActivity(null)
})

afterAll(() => {
  if (before) Object.defineProperty(globalThis, "localStorage", before)
  else Reflect.deleteProperty(globalThis, "localStorage")
})

const task: Task = { id: 4, title: wrote("Export the board"), status: "doing", createdBy: "jow", createdAt: 0, updatedAt: 0, notes: [], rounds: [], history: [], archived: false }
const event: Message = { seq: 9, from: "gentle-otter", at: new Date(2026, 9, 29, 10).getTime(), text: wrote("claimed T4"), where: { kind: "room", room: "general" }, system: true, task: 4 }

const channelWith = (tasks: Task[]) =>
  ({
    code: "c",
    title: "c",
    youOwn: true,
    you: "jow",
    repos: [],
    rooms: [],
    directs: [],
    theirs: [],
    people: [],
    nicknames: new Map(),
    messages: [],
    tasks,
    asks: [],
    connection: "live",
  }) as unknown as Channel

const render = (channel: Channel): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <Tracker channel={channel} />
    </AppContext.Provider>
  )

const pressed = (html: string, name: string): boolean => new RegExp(`aria-pressed="true"[^>]*>${name}<`).test(html)

describe("the second sidebar is Now and Activity in one place", () => {
  test("with tasks and no activity it is Now, with no toggle", () => {
    const html = render(channelWith([task]))
    expect(html).toContain('aria-label="Now"')
    expect(html).toContain("Export the board")
    expect(html).not.toContain("aria-pressed")
  })

  test("with both, a toggle picks one, and it opens on Now", () => {
    showActivity({ runs: [[event]], here: null, target: null })
    const html = render(channelWith([task]))
    expect(pressed(html, "Now")).toBe(true)
    expect(pressed(html, "Activity")).toBe(false)
    expect(html).toContain("Export the board")
  })

  test("it opens on Activity when that was the last choice", () => {
    saved = "activity"
    showActivity({ runs: [[event]], here: null, target: null })
    const html = render(channelWith([task]))
    expect(pressed(html, "Activity")).toBe(true)
    expect(html).toContain('aria-label="Activity"')
    expect(html).not.toContain("Export the board")
  })

  test("a conversation with no activity shows Now, whatever the last choice was", () => {
    saved = "activity"
    const html = render(channelWith([task]))
    expect(html).toContain('aria-label="Now"')
    expect(html).toContain("Export the board")
  })

  test("a jump to an event opens Activity", () => {
    showActivity({ runs: [[event]], here: null, target: 9 })
    expect(pressed(render(channelWith([task])), "Activity")).toBe(true)
  })

  test("with activity and no tasks it is Activity, with no toggle", () => {
    showActivity({ runs: [[event]], here: null, target: null })
    const html = render(channelWith([]))
    expect(html).toContain('aria-label="Activity"')
    expect(html).not.toContain("aria-pressed")
  })

  test("with neither, the column is empty", () => {
    expect(render(channelWith([]))).toBe("")
  })
})
