import "~/styles/github.css"
import { Fragment, type MouseEvent, type ReactNode } from "react"
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

import type { Draw, DrawTools } from "~/chat/markdown"
import { ciOf } from "~/github/groups"
import { IssueMark, PrMark } from "~/github/parts"
import { Avatar, cx, Dot } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { memberOf, type Channel, type ChannelTile, type Issue, type Person, type PullRequest, type Task } from "~/model"
import { Face } from "~/shell/rail"

export interface Lookup {
  task: (id: number) => Task | undefined
  person: (key: string) => Person | undefined
  pr: (key: string) => PullRequest | undefined
  issue: (key: string) => Issue | undefined
  tile: (code: string) => ChannelTile | undefined
}

export const NOTHING: Lookup = { task: () => undefined, person: () => undefined, pr: () => undefined, issue: () => undefined, tile: () => undefined }

export const lookupOf = (channel: Channel): Lookup => ({
  ...NOTHING,
  task: (id) => channel.tasks.find((x) => x.id === id),
  person: (name) => memberOf(channel, name),
  pr: (key) => channel.prs?.find((p) => `${p.repo}/${p.number}` === key),
  issue: (key) => channel.issues?.find((i) => `${i.repo}/${i.number}` === key),
})

const ROW = /^kiwi-(?:task|msg|pr|issue|mention):|^kiwi-page:(?:channel|agent):/
const DO = "kiwi-do:"
const BAR = "kiwi-bar"

const textOf = (node: ASTNode): string => node.content ?? (node.children ?? []).map(textOf).join("")
const urlOf = (node: ASTNode | undefined): string => (node?.type === "Link" ? (node.attributes?.url ?? "") : "")
const isGap = (node: ASTNode): boolean => node.type === "SoftBreak" || node.type === "LineBreak" || (node.type === "Text" && !node.content?.trim())
const solid = (node: ASTNode | undefined): ASTNode[] => (node?.children ?? []).filter((c) => !isGap(c))
const after = (url: string, lead: string): string => decodeURIComponent(url.slice(lead.length))

function actOf(node: ASTNode): { url: string; label: string; main: boolean } | null {
  const inner = node.type === "Strong" ? solid(node) : [node]
  const url = inner.length === 1 ? urlOf(inner[0]) : ""
  return url.startsWith(DO) ? { url, label: textOf(node), main: node.type === "Strong" } : null
}

function unled(nodes: readonly ASTNode[]): ASTNode[] {
  const [first, ...rest] = nodes
  if (first?.type !== "Text") return [...nodes]
  const content = (first.content ?? "").replace(/^\s*·\s*/, "")
  return content ? [{ ...first, content }, ...rest] : rest
}

const held = (e: MouseEvent) => e.preventDefault()

function propOf(item: ASTNode): { label: string; rest: ASTNode[] } | null {
  const [para, ...below] = item.children ?? []
  if (para?.type !== "Paragraph" || below.length) return null
  const kids = para.children ?? []
  const at = kids.findIndex((c) => !isGap(c))
  const head = kids[at]
  const next = kids[at + 1]
  if (head?.type !== "Strong" || next?.type !== "Text" || !/^\s*·/.test(next.content ?? "")) return null
  return { label: textOf(head), rest: unled(kids.slice(at + 1)) }
}

function toneOf(url: string, find: Lookup): string | undefined {
  const pr = url.startsWith("kiwi-pr:") ? find.pr(after(url, "kiwi-pr:")) : undefined
  const ci = pr && (pr.state === "open" || pr.state === "draft") ? ciOf(pr) : "none"
  return ci === "fail" ? "tone-alert" : ci === "running" ? "tone-doing" : undefined
}

function Lead({ url, find }: { url: string; find: Lookup }) {
  if (url.startsWith("kiwi-task:")) {
    const task = find.task(Number(after(url, "kiwi-task:")))
    return <Dot status={!task || task.cancelled ? "todo" : task.status} />
  }
  if (url.startsWith("kiwi-pr:")) {
    const pr = find.pr(after(url, "kiwi-pr:"))
    return pr ? <PrMark pr={pr} size={14} /> : <Icon name="pr" size={14} />
  }
  if (url.startsWith("kiwi-issue:")) {
    const issue = find.issue(after(url, "kiwi-issue:"))
    return issue ? <IssueMark issue={issue} size={14} /> : <Icon name="issue" size={14} />
  }
  if (url.startsWith("kiwi-mention:")) return <Avatar person={find.person(after(url, "kiwi-mention:"))} size="sm" />
  if (url.startsWith("kiwi-page:agent:")) return <Avatar person={find.person(after(url, "kiwi-page:agent:"))} size="sm" />
  if (url.startsWith("kiwi-page:channel:")) {
    const tile = find.tile(after(url, "kiwi-page:channel:"))
    return tile ? <Face tile={tile} /> : <Icon name="home" size={14} />
  }
  return <Icon name="spec" size={14} />
}

function Trail({ url, find }: { url: string; find: Lookup }) {
  if (!url.startsWith("kiwi-task:")) return null
  const owner = find.task(Number(after(url, "kiwi-task:")))?.owner
  const person = owner ? find.person(owner) : undefined
  return person ? <Avatar person={person} size="sm" /> : null
}

export function pieces(find: Lookup): Draw {
  const open = (tools: DrawTools, url: string) => (e: MouseEvent) => {
    e.preventDefault()
    tools.press(url)
  }

  const row = (item: ASTNode, key: number, tools: DrawTools, inCard: boolean): ReactNode => {
    const [para, ...below] = item.children ?? []
    const kids = para?.children ?? []
    const start = kids.findIndex((c) => !isGap(c))
    const head = kids[start]
    const rest = kids.slice(start + 1)
    const url = urlOf(head)
    const label = head ? textOf(head) : ""
    const more = unled(rest)
    return (
      <li key={key} className="pg-item">
        <div className="pg-row">
          <a className="pg-main" href={url} title={label} onClick={open(tools, url)} onAuxClick={held}>
            <span className={cx("side-icon", url.startsWith("kiwi-page:channel:") && "side-face")}>
              <Lead url={url} find={find} />
            </span>
            <span className="pg-name">{label}</span>
          </a>
          {more.length > 0 && <span className={cx("pg-meta num", toneOf(url, find))}>{tools.inline({ type: "Paragraph", children: more })}</span>}
          <Trail url={url} find={find} />
        </div>
        {below.length > 0 && (
          <div className="pg-nest">
            {below.map((b, i) => (
              <Fragment key={i}>{piece(b, i, below, tools, inCard) ?? tools.block(b, i)}</Fragment>
            ))}
          </div>
        )}
      </li>
    )
  }

  const piece = (node: ASTNode, at: number, all: readonly ASTNode[], tools: DrawTools, inCard: boolean): ReactNode | undefined => {
    if (node.type === "Heading") {
      const level = node.attributes?.level
      const [first, ...rest] = solid(node)
      const who = urlOf(first)
      if (level === "1") return <h1 className="pg-title">{tools.inline(node)}</h1>
      if (level === "2" && first && who.startsWith("kiwi-mention:")) {
        const sub = textOf({ type: "Paragraph", children: unled(rest) })
        return (
          <h2 className="pg-person">
            <a className="pg-who" href={who} onClick={open(tools, who)} onAuxClick={held}>
              <Avatar person={find.person(after(who, "kiwi-mention:"))} pip />
              <span className="pg-who-name">{textOf(first).replace(/^@/, "")}</span>
            </a>
            {sub && <span className="pg-who-sub">{sub}</span>}
          </h2>
        )
      }
      if (level === "2") return <h2 className="pg-label">{tools.inline(node)}</h2>
      if (level === "3") return <h3 className={inCard ? "pg-card-title" : "pg-sub"}>{tools.inline(node)}</h3>
      return undefined
    }
    if (node.type === "Paragraph") {
      const kids = solid(node)
      const acts = kids.map(actOf)
      if (kids.length && acts.every(Boolean))
        return (
          <div className="pg-acts">
            {acts.map((a, i) => (
              <button key={i} type="button" className={cx("btn", a?.main && "is-primary")} onClick={() => a && tools.press(a.url)}>
                {a?.label}
              </button>
            ))}
          </div>
        )
      const only = kids.length === 1 ? urlOf(kids[0]) : ""
      if (only.startsWith("kiwi-page:") && all[at + 1]?.type === "Heading")
        return (
          <a className="pg-crumb" href={only} onClick={open(tools, only)} onAuxClick={held}>
            <Icon name="back" size={14} />
            {kids[0] ? textOf(kids[0]) : ""}
          </a>
        )
      const before = all[at - 1]
      if (before?.type === "Heading" && before.attributes?.level === "1") return <p className="pg-facts">{tools.inline(node)}</p>
      if (before?.type === "CodeBlock" && before.attributes?.language?.trim() === BAR) return <p className="pg-note">{tools.inline(node)}</p>
      return undefined
    }
    if (node.type === "UnorderedList" || node.type === "OrderedList") {
      const items = node.children ?? []
      const heads = items.map((item) => solid(item.children?.[0]))
      if (items.length && heads.every((h) => h.length === 1 && urlOf(h[0]).startsWith(DO)))
        return (
          <div className="pg-opts">
            {heads.map((h, i) => (
              <button key={i} type="button" className="btn pg-opt" onClick={() => tools.press(urlOf(h[0]))}>
                {h[0] ? textOf(h[0]) : ""}
              </button>
            ))}
          </div>
        )
      const props = items.map(propOf)
      if (items.length && props.every(Boolean))
        return (
          <dl className="pg-props">
            {props.map((p, i) => (
              <Fragment key={i}>
                <dt>{p?.label}</dt>
                <dd>{tools.inline({ type: "Paragraph", children: p?.rest ?? [] })}</dd>
              </Fragment>
            ))}
          </dl>
        )
      if (items.length && items.every((item) => item.children?.[0]?.type === "Paragraph") && heads.every((h) => ROW.test(urlOf(h[0]))))
        return <ul className="pg-rows">{items.map((item, i) => row(item, i, tools, inCard))}</ul>
      return undefined
    }
    if (node.type === "Blockquote") {
      const kids = node.children ?? []
      return (
        <section className="pg-card">
          {kids.map((k, i) => (
            <Fragment key={i}>{piece(k, i, kids, tools, true) ?? tools.block(k, i)}</Fragment>
          ))}
        </section>
      )
    }
    if (node.type === "CodeBlock" && node.attributes?.language?.trim() === BAR) {
      const segs = textOf(node)
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .flatMap(([status, n]) => (status && Number(n) > 0 ? [{ status, n: Number(n) }] : []))
      return (
        <div className="pg-bar" role="img" aria-label={segs.map((s) => `${s.n} ${s.status}`).join(", ")}>
          {segs.map((s) => (
            <span key={s.status} className={`pg-seg is-${s.status}`} style={{ flexGrow: s.n }} title={`${s.n} ${s.status}`} />
          ))}
        </div>
      )
    }
    return undefined
  }

  return (node, at, all, tools) => piece(node, at, all, tools, false)
}
