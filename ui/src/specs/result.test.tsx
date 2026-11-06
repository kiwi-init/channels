import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { Channel, Person, Spec, Task } from "~/model"
import { ActContext, AppContext, type Act, type Ctx } from "~/nav"
import { Result } from "~/specs/result"
import { wrote } from "~/words"

const NOW = 1_800_000_000_000
const person = (name: string, display: string): Person => ({ name, kind: "agent", display, owner: false, you: false, presence: "online", lastSeen: NOW, joined: NOW, messages: 0 })

const cancelled: Task = {
  id: 7,
  title: wrote("Pair with @gentle-otter on export"),
  status: "todo",
  cancelled: true,
  createdBy: "jow",
  createdAt: NOW,
  updatedAt: NOW,
  notes: [{ by: "jow", at: NOW, text: wrote("Superseded by @gentle-otter's PR") }],
  rounds: [],
  history: [],
  archived: false,
}

const spec: Spec = {
  ask: 10,
  title: wrote("Export the board"),
  words: wrote("board as a spreadsheet"),
  by: "jow",
  at: NOW,
  text: wrote("# Export the board\n\n## Done when\n- [x] a button"),
  v: 2,
  edited: { by: "jow", at: NOW },
  edits: 0,
  editors: [],
  stage: "done",
  backs: [],
  tasks: [7],
}

const channel = {
  code: "c",
  title: "c",
  youOwn: true,
  you: "jow",
  repos: [],
  rooms: [],
  directs: [],
  theirs: [],
  people: [person("gentle-otter", "opus-coder")],
  nicknames: new Map([["gentle-otter", "opus-coder"]]),
  messages: [],
  tasks: [cancelled],
  asks: [],
  specs: [spec],
  connection: "live",
} as unknown as Channel

const render = (shown: Spec = spec): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <ActContext.Provider value={{ actions: {}, go: () => {}, toast: () => {} } as unknown as Act}>
        <Result channel={channel} spec={shown} />
      </ActContext.Provider>
    </AppContext.Provider>
  )

describe("a spec's result names agents by nickname (#1763)", () => {
  test("a cancelled task shows its title and last note, both by nickname", () => {
    const html = render()
    expect(html).toContain("Pair with @opus-coder on export")
    expect(html).toContain("cancelled: Superseded by @opus-coder&#x27;s PR")
    expect(html).not.toContain("[object Object]")
    expect(html).not.toContain("gentle-otter")
  })

  test("the verdict's note and a send-back note name agents by nickname", () => {
    const judged: Spec = {
      ...spec,
      stage: "accepted",
      result: { verdict: "accepted", by: "jow", at: NOW, note: wrote("thanks @gentle-otter") },
      backs: [{ by: "jow", at: NOW - 60_000, note: wrote("@gentle-otter, add the CSV header") }],
    }
    const html = render(judged)
    expect(html).toContain("“thanks @opus-coder”")
    expect(html).toContain("“@opus-coder, add the CSV header”")
    expect(html).not.toContain("gentle-otter")
  })
})
