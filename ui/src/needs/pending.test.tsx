import { describe, expect, test } from "bun:test"

import type { Event, Message as Wire, Step } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { holdsWork } from "@kiwi/core/state/asks.ts"
import { needsPerson } from "@kiwi/core/work.ts"
import { heldAsks } from "@kiwi/app/asks.ts"
import { homeOf } from "~/home"
import { asksOf } from "~/live/map"
import type { Ask, Channel, Message, Person, QuestionAsk, Task } from "~/model"
import { needsText } from "~/needs/needs"
import { openAsks } from "~/needs/open"
import { wrote } from "~/words"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow", sponsor: { user: "u-jow", name: "Jow" } },
  { name: "sam", pk: "pk-sam", owner: false, at: 0, active: true, kind: "human", display: "Sam", sponsor: { user: "u-sam", name: "Sam" } },
  { name: "lead", pk: "pk-lead", owner: false, at: 0, active: true, kind: "agent", sponsor: { user: "u-jow", name: "Jow" }, runs: { harness: "claude" } },
]

const step: Step = { why: "Only you can press keys in the app window.", needsPerson: "jow", run: ["kiwi --version"], expect: "It prints the new version." }

const wire = (seq: number, from: string, more: Record<string, unknown>): Wire => ({ v: 1, id: `m${seq}`, seq, from, pk: `pk-${from}`, sigOk: true, ts: seq * 1000, ...more }) as Wire
const said = (seq: number, from: string, body: string, more: Record<string, unknown> = {}): Wire => wire(seq, from, { kind: "msg", body, ...more })
const event = (seq: number, from: string, ev: Event): Wire => wire(seq, from, { kind: "event", body: ev.op, ev })
const decision = (seq: number, body: string, more: Record<string, unknown>): Wire => wire(seq, "lead", { kind: "blocking", body, to: ["jow"], esc: true, ...more })
const choice = (seq: number, body: string, holds?: number[]): Wire => decision(seq, body, { choices: ["A: yes", "B: no"], ...(holds ? { holds } : {}) })
const stepAsk = (seq: number, body: string, holds?: number[]): Wire => decision(seq, body, { step, ...(holds ? { holds } : {}) })

const base: Wire[] = [
  said(1, "jow", "can we have undo in every box?"),
  event(2, "jow", { op: "task.add", title: "open work", owner: "lead" } as Event),
  event(3, "jow", { op: "task.add", title: "finished work", owner: "lead" } as Event),
  event(4, "lead", { op: "task.update", task: 3, state: "done" } as Event),
]

const unheld: Wire[] = [
  choice(10, "Choice on a done task?", [3]),
  stepAsk(11, "Step on a done task", [3]),
  choice(12, "Choice holding nothing?"),
  stepAsk(13, "Step holding nothing"),
  choice(14, "Choice on an unknown id?", [99]),
  stepAsk(15, "Step on an unknown id", [99]),
]

const held: Wire[] = [choice(16, "Choice on open work?", [2]), stepAsk(17, "Step on the owner's ask", [1])]

const plain = wire(20, "lead", { kind: "ask", body: "Plain question holding nothing?", to: ["jow"] })

const asksFor = (messages: Wire[], me = "jow", owner = me === "jow") => asksOf(fold(messages, roster, 0), messages, me, owner, [], roster, new Map())

const person = (name: string, kind: Person["kind"]): Person => ({ name, kind, display: name, owner: name === "jow", you: name === "jow", presence: "online", lastSeen: 0, joined: 0, messages: 0 })

const channelOf = (asks: Ask[]): Channel =>
  ({
    code: "c",
    title: "c",
    youOwn: true,
    you: "jow",
    repos: [],
    rooms: [],
    directs: [],
    theirs: [],
    people: [person("jow", "human"), person("lead", "agent")],
    nicknames: new Map([["lead", "lead"]]),
    messages: [],
    tasks: [],
    taskGroups: [],
    asks,
    connection: "live",
  }) as unknown as Channel

const ids = (asks: Ask[]): string[] => asks.map((a) => a.id)
const text = (md: string): string => md.replace(/\\(.)/g, "$1")
const times = (md: string, s: string): number => text(md).split(s).length - 1

describe("an ask-human decision that holds no open work still waits in Needs you (#2690)", () => {
  test("each one is pending, holds no work, and has a card in the chat", () => {
    const messages = [...base, ...unheld]
    const state = fold(messages, roster, 0)
    const { askOf } = asksFor(messages)
    for (const m of unheld) {
      const pending = state.openAsks.find((a) => a.seq === m.seq)
      expect(pending).toBeDefined()
      expect(pending && holdsWork(state, pending)).toBe(false)
      expect(askOf.get(m.seq)).toBe(String(m.seq))
    }
  })

  test("each one counts, so the sidebar row, the page and the badge show the same number", () => {
    const messages = [...base, ...unheld]
    const { asks } = asksFor(messages)
    const channel = channelOf(asks)
    expect(ids(openAsks(channel)).sort()).toEqual(unheld.map((m) => String(m.seq)).sort())
    expect(openAsks(channel).length).toBe(6)
    const { md } = needsText(channel, () => {})
    for (const m of unheld) expect(times(md, String(m.body))).toBe(1)
    expect(md).not.toContain("kiwi-field:")
  })

  test("with a single such ask open, the count is one and the page has no all-clear", () => {
    const messages = [...base, choice(12, "Choice holding nothing?")]
    const channel = channelOf(asksFor(messages).asks)
    expect(openAsks(channel).length).toBe(1)
    const { m } = needsText(channel, () => {})
    expect([...m.fields.keys()].some((k) => k.endsWith("-clear"))).toBe(false)
  })

  test("with nothing pending the page shows its all-clear and the count is zero", () => {
    const channel = channelOf(asksFor(base).asks)
    expect(openAsks(channel).length).toBe(0)
    const { m } = needsText(channel, () => {})
    expect([...m.fields.keys()].some((k) => k.endsWith("-clear"))).toBe(true)
  })
})

describe("held work comes first, the rest says it holds nothing up (#2690)", () => {
  const messages = [...base, ...unheld, ...held, plain]
  const { asks } = asksFor(messages)
  const channel = channelOf(asks)

  test("the count and the home list take every waiting decision, held or not, and leave out the plain question", () => {
    expect(ids(openAsks(channel)).sort()).toEqual(["10", "11", "12", "13", "14", "15", "16", "17"])
    expect(homeOf(channel).asks.map((a) => a.id)).toEqual(["10", "11", "12", "13", "14", "15", "16", "17"])
  })

  test("on the page every card shows once, held work above the 'holding nothing up' heading and the others below it", () => {
    const md = text(needsText(channel, () => {}).md)
    const heading = md.indexOf("holding nothing up")
    expect(heading).toBeGreaterThan(-1)
    for (const m of held) {
      expect(times(md, String(m.body))).toBe(1)
      expect(md.indexOf(String(m.body))).toBeLessThan(heading)
    }
    for (const m of unheld) {
      expect(times(md, String(m.body))).toBe(1)
      expect(md.indexOf(String(m.body))).toBeGreaterThan(heading)
    }
  })

  test("a plain question holding nothing is listed as before but not counted", () => {
    const q = asks.find((a) => a.id === "20")
    expect(q).toMatchObject({ kind: "question", idle: true, plain: true })
    expect(ids(openAsks(channel))).not.toContain("20")
    expect(times(needsText(channel, () => {}).md, "Plain question holding nothing?")).toBe(1)
  })

  test("someone the ask isn't for gets no card and no count", () => {
    const theirs = asksFor(messages, "sam", false).asks
    expect(theirs.filter((a) => a.kind === "question")).toEqual([])
    expect(openAsks(channelOf(theirs)).length).toBe(0)
  })
})

describe("the CLI, the work summary and iOS keep holding work as their rule (#2690)", () => {
  const messages = [...base, ...unheld, ...held, plain]
  const state = fold(messages, roster, 0)

  test("iOS heldAsks and the work summary list only the asks that hold open work", () => {
    expect(heldAsks(state).map((m) => m.seq)).toEqual([16, 17])
    expect(
      needsPerson(state)
        .map((n) => n.seq)
        .sort()
    ).toEqual([16, 17])
  })
})

describe("an answered or closed decision leaves at once (#2690)", () => {
  test("a tapped answer takes it out of the count", () => {
    const messages = [...base, choice(12, "Choice holding nothing?"), said(30, "jow", "A: yes", { re: [12], to: ["lead"], pick: true })]
    expect(openAsks(channelOf(asksFor(messages).asks)).length).toBe(0)
  })

  test("a step marked done takes it out of the count", () => {
    const messages = [...base, stepAsk(13, "Step holding nothing"), said(30, "jow", "Done", { re: [13], to: ["lead"], stepReply: { outcome: "done" } })]
    expect(openAsks(channelOf(asksFor(messages).asks)).length).toBe(0)
  })

  test("the asker closing it takes it out of the count", () => {
    const messages = [...base, choice(12, "Choice holding nothing?"), wire(30, "lead", { kind: "event", body: "closed #12", ev: { op: "ask.close", ask: 12 }, re: [12] })]
    expect(openAsks(channelOf(asksFor(messages).asks)).length).toBe(0)
  })
})

describe("the card shows what the ask holds: a task, or a person's message (#2690)", () => {
  const card = (holds: number[]): QuestionAsk => ({ kind: "question", id: "q", from: "lead", at: 5, text: wrote("Which one?"), label: "Decision for you", options: ["A", "B"].map(wrote), holds })
  const longText = "just simulate a real ask so I can look at Needs you before answering it, and tell me what it holds"
  const held = (asks: QuestionAsk[], more: Partial<Channel>) =>
    text(
      needsText(
        {
          ...channelOf(asks),
          ...more,
          nicknames: new Map([
            ["lead", "lead"],
            ["jow", "Jow"],
          ]),
        } as Channel,
        () => {}
      ).md
    )
  const message = { seq: 7, from: "jow", at: 1, text: wrote(longText), where: { kind: "room", room: "general" } } as Message
  const task = { id: 2, title: wrote("open work"), status: "doing" } as unknown as Task

  test("a held message shows its author, the start of its text, and a link to it", () => {
    const md = held([card([7])], { messages: [message] })
    expect(md).toContain("[Jow](<kiwi-face:")
    expect(md).toContain(`[${longText.slice(0, 80)}…](<kiwi-msg:7>)`)
  })

  test("a held message that isn't loaded shows from the ask head its tasks are filed under", () => {
    const md = held([card([7])], { taskGroups: [{ key: "ask:7", head: { kind: "ask", id: 7, by: "jow", words: "just simulate", mayName: true }, tasks: [2] }] })
    expect(md).toContain("[just simulate](<kiwi-msg:7>)")
    expect(md).toContain("[Jow](<kiwi-face:")
  })

  test("a held task shows as before, and an id that is neither shows no line", () => {
    const md = held([card([2, 99])], { tasks: [task] })
    expect(md).toContain("(<kiwi-task:2>)")
    expect(md).not.toContain("kiwi-msg:99")
    expect(md).not.toContain("kiwi-task:99")
  })
})
