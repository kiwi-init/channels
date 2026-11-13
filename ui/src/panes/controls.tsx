import "~/i18n/en/chat-later"
import "~/styles/controls.css"

import { Fragment, type MouseEvent, type ReactNode } from "react"
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

import type { Draw, DrawTools } from "~/chat/markdown"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Toggle } from "~/kit/form"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { doOf } from "~/panes/engine"

export interface Parts {
  field: (name: string) => ReactNode | undefined
  mark: (name: string) => ReactNode | undefined
}

type Tone = "label" | "hint" | "line"

interface Choice {
  url: string
  label: string
  on: boolean
}

interface Row {
  on: boolean | null
  url: string
  marks: string[]
  label: ASTNode[]
  hint: ASTNode[]
  line: ASTNode[]
  nested: ASTNode[]
}

const DO = "kiwi-do:"
const FIELD = "kiwi-field"
const DOT = "·"

const textOf = (node: ASTNode): string => node.content ?? (node.children ?? []).map(textOf).join("")
const urlOf = (node: ASTNode | undefined): string => (node?.type === "Link" ? (node.attributes?.url ?? "") : "")
const isBreak = (node: ASTNode): boolean => node.type === "SoftBreak" || node.type === "LineBreak"
const isGap = (node: ASTNode): boolean => isBreak(node) || (node.type === "Text" && !node.content?.trim())
const solid = (nodes: readonly ASTNode[] | undefined): ASTNode[] => (nodes ?? []).filter((c) => !isGap(c))
const isDo = (node: ASTNode | undefined): boolean => doOf(urlOf(node)).act
const isList = (node: ASTNode | undefined): boolean => node?.type === "UnorderedList" || node?.type === "OrderedList"
const words = (content: string): ASTNode => ({ type: "Text", content })
const isChip = (node: ASTNode): boolean => {
  const kids = solid(node.children)
  return node.type === "Link" && isDo(node) && kids.length === 1 && kids[0]?.type === "Code"
}
const held = (e: MouseEvent) => e.preventDefault()

function choiceOf(node: ASTNode | undefined): Choice | null {
  if (node && isDo(node)) return { url: urlOf(node), label: textOf(node), on: false }
  const inner = node?.type === "Strong" ? solid(node.children) : []
  return inner.length === 1 && isDo(inner[0]) ? { url: urlOf(inner[0]), label: textOf(inner[0]), on: true } : null
}

function choicesOf(node: ASTNode | undefined): Choice[] | null {
  if (!node || !isList(node)) return null
  const items = node.children ?? []
  const picked = items.flatMap((item) => {
    const kids = item.children ?? []
    const head = solid(kids[0]?.children)
    const choice = kids.length === 1 && item.attributes?.isTask !== "true" && head.length === 1 ? choiceOf(head[0]) : null
    return choice ? [choice] : []
  })
  return picked.length && picked.length === items.length && picked.some((c) => c.on) ? picked : null
}

const fieldOf = (node: ASTNode | undefined): string | null => (node?.type === "CodeBlock" && node.attributes?.language?.trim() === FIELD ? textOf(node).trim() : null)

function linesOf(node: ASTNode): ASTNode[][] {
  const out: ASTNode[][] = [[]]
  for (const child of node.children ?? []) {
    if (isBreak(child)) out.push([])
    else out[out.length - 1]?.push(child)
  }
  return out
}

function cut(nodes: readonly ASTNode[]): [ASTNode[], ASTNode[]] {
  const at = nodes.findIndex((n) => n.type === "Text" && n.content?.includes(DOT))
  if (at < 0) return [[...nodes], []]
  const text = nodes[at]?.content ?? ""
  const split = text.indexOf(DOT)
  const before = text.slice(0, split).trimEnd()
  const after = text.slice(split + DOT.length).trimStart()
  return [
    [...nodes.slice(0, at), ...(before ? [words(before)] : [])],
    [...(after ? [words(after)] : []), ...nodes.slice(at + 1)],
  ]
}

function rowOf(item: ASTNode, parts: Parts): Row | null {
  const [para, ...nested] = item.children ?? []
  if (para?.type !== "Paragraph") return null
  const [first = [], ...rest] = linesOf(para)
  const isMark = (n: ASTNode) => n.type === "Code" && parts.mark(textOf(n)) !== undefined
  const at = first.findIndex((n) => !isGap(n) && !isMark(n))
  if (at < 0) return null
  const head = first[at]
  const marks = first.slice(0, at).filter(isMark).map(textOf)
  const line = rest.flat()
  if (item.attributes?.isTask === "true") {
    if (!head || !isDo(head)) return null
    return { on: item.attributes.taskChecked === "true", url: urlOf(head), marks, label: head.children ?? [], hint: cut(first.slice(at + 1))[1], line, nested }
  }
  if (head?.type !== "Strong" || choiceOf(head)) return null
  const [label, hint] = cut(first.slice(at))
  return { on: null, url: "", marks, label, hint, line, nested }
}

export function withControls(draw: Draw, parts: Parts): Draw {
  const go = (tools: DrawTools, url: string) => (e: MouseEvent) => {
    e.preventDefault()
    tools.press(url)
  }

  const inline = (nodes: readonly ASTNode[], tools: DrawTools, tone: Tone): ReactNode[] => nodes.map((node, key) => one(node, key, tools, tone))

  const face = (nodes: readonly ASTNode[]): ReactNode => {
    const marks = nodes.map((n) => (n.type === "Code" ? parts.mark(textOf(n)) : undefined))
    if (marks.every((m) => m === undefined)) return textOf({ type: "Paragraph", children: [...nodes] })
    return nodes.map((n, i) => <Fragment key={i}>{marks[i] ?? textOf(n).trim()}</Fragment>)
  }

  const link = (node: ASTNode, key: number, tools: DrawTools, tone: Tone, loud: boolean): ReactNode => {
    const url = urlOf(node)
    const did = doOf(url)
    const label = textOf(node)
    if (url.startsWith(DO) && !did.act)
      return (
        <span key={key} className={cx(did.tone, loud && tone !== "label" && "ctl-loud") || undefined} title={did.tip}>
          {inline(node.children ?? [], tools, tone === "label" ? "label" : "hint")}
        </span>
      )
    if (!url || tone === "label") return <Fragment key={key}>{label}</Fragment>
    if (isChip(node))
      return (
        <button
          key={key}
          type="button"
          className="ctl-chip"
          aria-label={did.label ?? t("chat.markdown.copy.text", { text: label })}
          title={did.tip ?? did.label ?? t("chat.markdown.copy")}
          onClick={() => tools.press(did.url)}
        >
          <span className="ctl-code">{label}</span>
          <Icon name="copy" size={14} />
        </button>
      )
    if (tone === "hint")
      return (
        <a key={key} className="ctl-link" href={did.url} title={did.tip} aria-label={did.label} onClick={go(tools, did.url)} onAuxClick={held}>
          {label}
        </a>
      )
    const look = cx("btn is-small", loud ? "is-primary" : "is-quiet")
    if (did.act)
      return (
        <button key={key} type="button" className={look} title={did.tip} aria-label={did.label} onClick={() => tools.press(did.url)}>
          {face(node.children ?? [])}
        </button>
      )
    return (
      <a key={key} className={look} href={url} onClick={go(tools, url)} onAuxClick={held}>
        {label}
      </a>
    )
  }

  const one = (node: ASTNode, key: number, tools: DrawTools, tone: Tone): ReactNode => {
    if (isBreak(node)) return tone === "line" ? null : " "
    if (node.type === "Text") {
      const text = node.content ?? ""
      if (tone !== "line") return text
      return text.trim() ? (
        <span key={key} className="ctl-value">
          {text.trim()}
        </span>
      ) : null
    }
    if (node.type === "Code") {
      const text = textOf(node)
      const mark = tone === "label" ? undefined : parts.mark(text)
      if (mark !== undefined)
        return (
          <span key={key} className="ctl-mark is-inline" aria-hidden="true">
            {mark}
          </span>
        )
      return (
        <code key={key} className={tone === "label" ? "ctl-tag" : "ctl-code"}>
          {text}
        </code>
      )
    }
    if (node.type === "Link") return link(node, key, tools, tone, false)
    const inner = solid(node.children)
    if (node.type === "Strong" && inner.length === 1 && inner[0]?.type === "Link") return link(inner[0], key, tools, tone, true)
    if (node.type === "Strong" && tone !== "label")
      return (
        <strong key={key} className="ctl-loud">
          {inline(node.children ?? [], tools, "hint")}
        </strong>
      )
    if (node.type === "Emphasis" && tone !== "label")
      return (
        <span key={key} className="ctl-quiet">
          {inline(node.children ?? [], tools, "hint")}
        </span>
      )
    return <Fragment key={key}>{inline(node.children ?? [], tools, tone === "line" ? "hint" : tone)}</Fragment>
  }

  const seg = (choices: readonly Choice[], label: string | undefined, tools: DrawTools) => (
    <Track className="seg" role="group" aria-label={label}>
      {choices.map((c) => (
        <button key={c.url} type="button" aria-pressed={c.on} onClick={() => tools.press(c.url)}>
          {c.label}
        </button>
      ))}
    </Track>
  )

  const controlOf = (node: ASTNode | undefined, label: string, tools: DrawTools): ReactNode | undefined => {
    const choices = choicesOf(node)
    if (choices) return seg(choices, label, tools)
    const name = fieldOf(node)
    return name === null ? undefined : (parts.field(name) ?? null)
  }

  const row = (r: Row, key: number, tools: DrawTools): ReactNode => {
    const name = r.label.map(textOf).join("").trim()
    const own = r.on === null && !r.line.length ? controlOf(r.nested[0], name, tools) : undefined
    const below = own === undefined ? r.nested : r.nested.slice(1)
    const control = r.on !== null ? <Toggle label={name} on={r.on} onChange={() => tools.press(r.url)} /> : r.line.length ? inline(r.line, tools, "line") : own
    return (
      <li key={key} className={cx("ctl-row", r.on !== null && "is-switch")}>
        <div className="ctl-line">
          <div className="ctl-head">
            {r.marks.length > 0 && (
              <span className="ctl-mark" aria-hidden="true">
                {r.marks.map((m) => (
                  <Fragment key={m}>{parts.mark(m)}</Fragment>
                ))}
              </span>
            )}
            <div className="ctl-text">
              <span className="ctl-label">{inline(r.label, tools, "label")}</span>
              {r.hint.length > 0 && <span className="ctl-hint">{inline(r.hint, tools, "hint")}</span>}
            </div>
          </div>
          {control !== undefined && control !== null && <div className="ctl-ctl">{control}</div>}
        </div>
        {below.length > 0 && <div className="ctl-below">{blocks(below, tools)}</div>}
      </li>
    )
  }

  const mine = (node: ASTNode, tools: DrawTools): ReactNode | undefined => {
    const name = fieldOf(node)
    if (name !== null) return parts.field(name) ?? null
    const choices = choicesOf(node)
    if (choices) return <div className="ctl-choices">{seg(choices, undefined, tools)}</div>
    if (isList(node)) {
      const items = node.children ?? []
      const rows = items.flatMap((item) => {
        const r = rowOf(item, parts)
        return r ? [r] : []
      })
      return rows.length && rows.length === items.length ? <ul className="ctl-rows">{rows.map((r, i) => row(r, i, tools))}</ul> : undefined
    }
    if (node.type === "Admonition")
      return (
        <div className={cx("ctl-note", `is-${node.attributes?.admonitionType ?? "note"}`)} role="note">
          {(node.children ?? []).map((p, i) => (
            <p key={i}>{inline(p.children ?? [], tools, "hint")}</p>
          ))}
        </div>
      )
    if (node.type === "Paragraph") {
      const kids = solid(node.children)
      if (kids.length && kids.every(isChip)) return <p className="ctl-chips">{kids.map((k, i) => link(k, i, tools, "line", false))}</p>
      const only = kids.length === 1 ? kids[0] : undefined
      return only?.type === "Emphasis" ? <p className="ctl-fine">{inline(only.children ?? [], tools, "hint")}</p> : undefined
    }
    if (node.type === "Blockquote") {
      const kids = node.children ?? []
      return (
        <section className="pg-card ctl-card">
          {kids.map((k, i) => (
            <Fragment key={i}>{k.type === "Heading" && k.attributes?.level === "3" ? <h3 className="pg-card-title">{inline(k.children ?? [], tools, "hint")}</h3> : block(k, i, kids, tools)}</Fragment>
          ))}
        </section>
      )
    }
    return undefined
  }

  const block = (node: ASTNode, at: number, all: readonly ASTNode[], tools: DrawTools): ReactNode => mine(node, tools) ?? draw(node, at, all, tools) ?? tools.block(node, at)

  const blocks = (nodes: readonly ASTNode[], tools: DrawTools): ReactNode =>
    nodes.map((node, i) => (
      <div key={i} className="ctl-nest">
        {block(node, i, nodes, tools)}
      </div>
    ))

  return (node, at, all, tools) => mine(node, tools) ?? draw(node, at, all, tools)
}
