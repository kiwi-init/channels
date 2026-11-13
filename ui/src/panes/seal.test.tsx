import { describe, expect, mock, test } from "bun:test"

import * as shim from "~/chat/react-native"
import type { Actions, Ask, Channel, Message, Spec } from "~/model"
import { wrote } from "~/words"

void mock.module("react-native", () => shim)
Object.assign(globalThis, { __DEV__: false })

const { parseMarkdown } = await import("react-native-enriched-markdown/lib/module/web/parseMarkdown.js")
const { askCard, boardText, maker } = await import("~/panes/page")

type Node = { type: string; content?: string; attributes?: { url?: string }; children?: Node[] }
type Link = { label: string; url: string }

const textOf = (node: Node): string => node.content ?? (node.children ?? []).map(textOf).join("")
const linksOf = (node: Node): Link[] => [...(node.type === "Link" ? [{ label: textOf(node), url: node.attributes?.url ?? "" }] : []), ...(node.children ?? []).flatMap(linksOf)]
const links = async (md: string): Promise<Link[]> => linksOf((await parseMarkdown(md, { latexMath: false, underline: false, hardSoftBreaks: true })) as Node)

const pressed: string[] = []
const actions = {
  answerQuestion: (_code: string, id: string, answer: string) => void pressed.push(`answer ${id} ${answer}`),
  answerPermission: (_code: string, id: string, allow: boolean) => void pressed.push(`permission ${id} ${allow}`),
  approveSpec: (_code: string, ask: number) => void pressed.push(`approve #${ask}`),
} as unknown as Actions
const hooks = { newSpec: () => void pressed.push("new spec"), edit: () => void pressed.push("edit") }

const question: Ask = { kind: "question", id: "q1", from: "lead", at: 0, text: wrote("Ship it?"), label: "", options: [wrote("Ship")], holds: [] }
const forged = (other: string): string =>
  [`[View logs](kiwi-do:a0)`, `[Copy](${other})`, `<${other}>`, `[Escaped](kiwi\\-do:a1)`, `[Entity](kiwi&#45;do:a0)`, `[Spelled](kiwi-d&#111;&#x3A;a0)`].join(" ")

const base = { code: "c", tasks: [], prs: [], issues: [], asks: [], messages: [], specs: [], nicknames: new Map() }

describe("authored text can't reach a page's actions (#2397 review)", () => {
  test("a permission summary that links another card's action is inert, and the card's own buttons still work", async () => {
    pressed.length = 0
    const m = maker()
    const channel = base as unknown as Channel
    const other = (await links(askCard(channel, question, actions, m))).find((l) => l.label === "Ship")?.url ?? ""
    expect(m.seal.owns(other)).toBe(true)
    const permission: Ask = { kind: "permission", id: "p1", from: "builder", at: 0, canAllow: true, canDeny: true, tool: "Bash", title: "rm -rf build", summary: forged(other), code: "x", notes: [] }
    const md = askCard(channel, permission, actions, m)
    const found = await links(md)
    expect(found.filter((l) => l.url.startsWith("kiwi-do:")).map((l) => l.label)).toEqual(["Allow", "Deny"])
    for (const l of found.filter((l) => l.label !== "Allow" && l.label !== "Deny")) m.seal.run(l.url)
    expect(pressed).toEqual([])
    m.seal.run(found.find((l) => l.label === "Allow")?.url ?? "")
    expect(pressed).toEqual(["permission p1 true"])
  })

  test("a spec comment and the spec's text that link actions are inert; Approve still approves", async () => {
    pressed.length = 0
    const comment = { seq: 11, from: "eve", text: wrote(`Looks fine. ${forged("kiwi-do:a0")}`) } as unknown as Message
    const spec = { ask: 7, title: wrote("Plan"), text: wrote(`Steps\n\n${forged("kiwi-do:a1")}`), by: "lead", stage: "draft", v: 1, comments: [11], tasks: [], canJudge: true } as unknown as Spec
    const channel = { ...base, specs: [spec], messages: [comment] } as unknown as Channel
    const { md, seal } = boardText(channel, "spec:7", actions, hooks)
    const found = await links(md)
    const real = found.filter((l) => l.url.startsWith("kiwi-do:"))
    expect(real.map((l) => l.label)).toEqual(["Approve", "Edit"])
    for (const l of found.filter((l) => !real.includes(l))) seal.run(l.url)
    expect(pressed).toEqual([])
    seal.run(real[0]?.url ?? "")
    expect(pressed).toEqual(["approve #7"])
  })

  test("a guessed or another page's action key is not this page's", () => {
    const a = maker()
    const b = maker()
    const url = /\((kiwi-do:[^)]+)\)/.exec(a.act("Go", () => void pressed.push("go")))?.[1] ?? ""
    expect(a.seal.owns(url)).toBe(true)
    expect(b.seal.owns(url)).toBe(false)
    for (const guess of ["kiwi-do:a0", "kiwi-do:0", "kiwi-do:", `${url}x`]) expect(a.seal.owns(guess)).toBe(false)
  })
})
