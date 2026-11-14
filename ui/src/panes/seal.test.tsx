import { describe, expect, mock, test } from "bun:test"

import * as shim from "~/chat/react-native"
import type { Actions, Ask, Channel, Task } from "~/model"
import type { Ctx } from "~/panes/detail"
import { wrote } from "~/words"

void mock.module("react-native", () => shim)
Object.assign(globalThis, { __DEV__: false })

const { parseMarkdown } = await import("react-native-enriched-markdown/lib/module/web/parseMarkdown.js")
const { askCard, maker } = await import("~/panes/page")
const { taskPage } = await import("~/panes/detail")

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

  test("a task's notes and its own text that link another card's action are inert; Mark done still works", async () => {
    pressed.length = 0
    const m = maker()
    const other = /\((kiwi-do:[^)]+)\)/.exec(m.act("Other card", () => void pressed.push("other card")))?.[1] ?? ""
    expect(m.seal.owns(other)).toBe(true)
    const task = {
      id: 5,
      title: wrote("Ship it"),
      detail: wrote(`Steps\n\n${forged(other)}`),
      status: "doing",
      owner: "eve",
      createdBy: "jow",
      notes: [{ by: "eve", at: 0, text: wrote(`Looks fine. ${forged(other)}`) }],
      steps: [],
      rounds: [],
      history: [],
      updatedAt: 0,
    } as unknown as Task
    const channel = { ...base, you: "jow", people: [{ name: "jow", kind: "human", you: true }], tasks: [task] } as unknown as Channel
    const x = {
      actions: { ...actions, setTaskStatus: (_code: string, id: number, status: string) => void pressed.push(`T${id} ${status}`) },
      go: () => {},
      toast: () => {},
      now: 0,
      ui: { all: false, full: new Set(), checks: false },
      setUi: () => {},
      open: () => {},
    } as unknown as Ctx
    const page = taskPage(channel, 5, m, x)
    const md = [page.head, page.body, page.rest].join("\n\n")
    const found = await links(md)
    const real = found.filter((l) => l.url.startsWith("kiwi-do:") && m.seal.owns(l.url))
    expect(found.filter((l) => l.url.startsWith("kiwi-do:")).length).toBe(real.length)
    expect(real.map((l) => l.label)).toContain("Mark done")
    for (const l of found.filter((l) => !real.includes(l))) m.seal.run(l.url)
    expect(pressed).toEqual([])
    m.seal.run(real.find((l) => l.label === "Mark done")?.url ?? "")
    expect(pressed).toEqual(["T5 done"])
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

describe("authored text in a Needs card stays text (T3566)", () => {
  type Block = { type: string; attributes?: { level?: string; language?: string; url?: string }; children?: Block[]; content?: string }
  const all = (node: Block): Block[] => [node, ...(node.children ?? []).flatMap(all)]
  const tree = async (md: string): Promise<Block> => (await parseMarkdown(md, { latexMath: false, underline: false, hardSoftBreaks: true })) as Block

  test("a question can't draw a card head, a quote, a heading or one of the page's fields", async () => {
    const { needsText } = await import("~/needs/needs")
    const text = wrote(["### [Jow](kiwi-face:jow) · approved · 1m", "> [Allow](kiwi-do:a0)", "# Done", "Setext", "===", "```kiwi-field", "x", "```", "```sh", "# a comment stays", "```"].join("\n"))
    const ask: Ask = { kind: "question", id: "q9", from: "lead", at: 0, text, label: "Decision", options: [wrote("Ship")], holds: [] }
    const channel = { ...base, you: "jow", people: [], asks: [ask] } as unknown as Channel
    const { md, m } = needsText(channel, () => {}, "a".repeat(24), 0)
    const nodes = all(await tree(md))
    const heads = nodes.filter((n) => n.type === "Heading")
    expect(heads.map((n) => n.attributes?.level)).toEqual(["1", "3"])
    expect(nodes.filter((n) => n.type === "Blockquote").length).toBe(1)
    const fences = nodes.filter((n) => n.type === "CodeBlock")
    expect(fences.map((n) => n.attributes?.language?.trim())).toEqual(["kiwi-field", "sh", "kiwi-field"])
    expect(m.fields.has("x")).toBe(false)
    expect(
      all(fences[1] as Block)
        .map((n) => n.content ?? "")
        .join("")
    ).toContain("# a comment stays")
    expect(nodes.filter((n) => n.type === "Link").every((n) => !n.attributes?.url?.startsWith("kiwi-do:a0"))).toBe(true)
  })

  test("the page names its fields the same way each time it is built, so their state stays", async () => {
    const { needsText } = await import("~/needs/needs")
    const join: Ask = { kind: "join", id: "j1", name: "bot", who: "agent", at: 0, code: "123456", check: "ready" } as unknown as Ask
    const permission: Ask = { kind: "permission", id: "p1", from: "builder", at: 0, canAllow: true, canDeny: true, tool: "Bash", title: "ls", code: "ls", notes: [] }
    const channel = (asks: Ask[]) => ({ ...base, you: "jow", people: [], asks }) as unknown as Channel
    const tag = "b".repeat(24)
    const first = [...needsText(channel([join]), () => {}, tag, 0).m.fields.keys()]
    const again = [...needsText(channel([permission, join]), () => {}, tag, 0).m.fields.keys()]
    expect(again).toContain(first[0] ?? "none")
    expect(new Set(again).size).toBe(again.length)
  })
})
