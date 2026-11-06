import { beforeAll, describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Task } from "~/model"
import { AppContext, type Ctx } from "~/nav"
import { NowCard } from "~/tasks/now"
import { wrote } from "~/words"

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => "0", setItem: () => {} } })
})

const done = (id: number, title: string): Task => ({
  id,
  title: wrote(title),
  status: "done",
  createdBy: "jow",
  createdAt: 0,
  updatedAt: Date.now(),
  notes: [],
  rounds: [],
  history: [],
  archived: false,
})

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
  tasks: [done(1, "Pair with @gentle-otter on export"), done(2, "Ship the CSV")],
  asks: [],
  connection: "live",
} as unknown as Channel

describe("Now's done-today line names agents by nickname (#1763)", () => {
  test("every title reads as text, by nickname", () => {
    const html = renderToStaticMarkup(
      <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
        <NowCard channel={channel} />
      </AppContext.Provider>
    )
    expect(html).toContain("Pair with @opus-coder on export")
    expect(html).toContain("Ship the CSV")
    expect(html).not.toContain("gentle-otter")
  })
})
