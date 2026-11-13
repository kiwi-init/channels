import { describe, expect, test } from "bun:test"

import type { Actions, ChannelTile, HomeAgent, HomeChannel, Person } from "~/model"
import { homeText } from "~/panes/home"

const tile = (code: string, title: string, needsYou = 0): ChannelTile => ({ code, title, state: "member", unread: 0, needsYou, last: 0 })

const agent = (name: string, state: HomeAgent["state"], task: string | null): HomeAgent => ({
  name,
  nick: name,
  person: { name, kind: "agent", owner: false, you: false, presence: state === "away" ? "offline" : "online", harness: "claude" } as Person,
  state,
  doing: state === "working" ? "thinking" : state,
  task: task ? { id: 1, title: task } : null,
})

const home = (code: string, title: string, more: Partial<HomeChannel> = {}): HomeChannel => ({
  code,
  title,
  lead: null,
  leadName: null,
  working: 0,
  asks: [],
  moving: [],
  more: 0,
  doneToday: 0,
  red: 0,
  agents: [],
  said: null,
  ...more,
})

const LONG_A = "A: Bench test: sheet generator + reader on the phone, 3 printed densities"
const LONG_B = "B: Straight to print with the densest layout"

const answered: string[] = []
const actions = { answerQuestion: (_code: string, _id: string, answer: string) => void answered.push(answer) } as unknown as Actions

const page = () =>
  homeText(
    [tile("launch", "channels-launch"), tile("reedy", "Reedy"), tile("notes", "kiwinotes"), tile("omni", "OmniRad", 1)],
    [
      home("launch", "channels-launch", {
        doneToday: 5,
        agents: [agent("builder-one", "working", "Shots: onboarding check"), agent("builder-three", "working", null), agent("ivy", "idle", null)],
      }),
      home("reedy", "Reedy"),
      home("notes", "kiwinotes", { agents: [agent("megabrain", "away", null)] }),
      home("omni", "OmniRad", {
        agents: [agent("hyper", "away", null)],
        asks: [{ id: "q", at: 0, what: "hyper asks", text: "Bench test or print?", act: { kind: "options", options: [LONG_A, LONG_B].map((o) => ({ shown: o, answer: o })) } }],
      }),
    ],
    actions,
    () => {}
  )

describe("Home is a markdown page (#509, T2632)", () => {
  test("a question comes first, its answers each a whole button that answers it", () => {
    const { md, seal } = page()
    expect(md.indexOf("### OmniRad · hyper asks")).toBeLessThan(md.indexOf("## Channels"))
    const buttons = Array.from(md.matchAll(/^- \[(.+)\]\((kiwi-do:[^)]+)\)$/gm), (m) => ({ label: m[1], url: m[2] ?? "" }))
    expect(buttons.map((b) => b.label)).toEqual([LONG_A, LONG_B])
    seal.run(buttons[1]?.url ?? "")
    expect(answered).toEqual([LONG_B])
  })

  test("a channel's working agents sit under it with their task; idle and away agents stay off the page", () => {
    const { md } = page()
    expect(md).toContain("[builder-one](<kiwi-page:agent:launch:builder-one>) · thinking · Shots: onboarding check")
    expect(md).toContain("[builder-three](<kiwi-page:agent:launch:builder-three>)")
    expect(md).not.toContain("ivy")
    expect(md).not.toContain("megabrain")
  })

  test("every channel is one row that opens it, with what it did today", () => {
    const { md } = page()
    expect(md).toContain("- [channels-launch](<kiwi-page:channel:launch>) · 5 done today")
    for (const code of ["reedy", "notes", "omni"]) expect(md).toContain(`(<kiwi-page:channel:${code}>)`)
  })
})
