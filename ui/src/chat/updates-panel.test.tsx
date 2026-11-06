import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { Panel } from "~/chat/updates-panel"
import type { Channel, Message, Task } from "~/model"
import { AppContext, type Ctx } from "~/nav"
import { wrote } from "~/words"

const day = new Date(2026, 9, 29, 10).getTime()
const general = { kind: "room", room: "general" } as const
const ev = (seq: number, text: string, more: Partial<Message> = {}): Message => ({ seq, from: "gentle-otter", at: day + seq * 60_000, text: wrote(text), where: general, system: true, ...more })
const task: Task = { id: 4, title: wrote("Export"), status: "doing", createdBy: "jow", createdAt: 0, updatedAt: 0, notes: [], rounds: [], history: [], archived: false }

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

const render = (run: Message[]): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { channel }, go: () => {} } as unknown as Ctx}>
      <Panel channel={channel} runs={[run]} here={null} target={run[0]!.seq} onClose={() => {}} />
    </AppContext.Provider>
  )

describe("a folded updates row's tooltip names agents by nickname (#1763)", () => {
  test("a run of task events", () => {
    const html = render([ev(1, "@gentle-otter took T4", { task: 4 }), ev(2, "@gentle-otter moved T4 to review", { task: 4 })])
    expect(html).toContain('title="@opus-coder took T4\n@opus-coder moved T4 to review"')
    expect(html).not.toContain("gentle-otter")
  })

  test("a run of GitHub events", () => {
    const pr = { event: "pull_request", repo: "kiwi-init/channels", number: 9, action: "opened", url: "https://github.com/kiwi-init/channels/pull/9" }
    const html = render([ev(1, "@gentle-otter opened PR #9", { github: [pr] }), ev(2, "@gentle-otter edited PR #9", { github: [{ ...pr, action: "edited" }] })])
    expect(html).toContain('title="@opus-coder opened PR #9\n@opus-coder edited PR #9"')
    expect(html).not.toContain("gentle-otter")
  })
})
