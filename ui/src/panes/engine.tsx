import "~/styles/github.css"
import { CancelCircleIcon, CheckmarkCircle02Icon, CircleDashedIcon, Loading03Icon, MinusSignCircleIcon } from "@hugeicons/core-free-icons"
import { Fragment, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react"
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

import type { Draw, DrawTools } from "~/chat/markdown"
import { ciOf } from "~/github/groups"
import { IssueMark, PrMark } from "~/github/parts"
import { Avatar, Count, cx, Dot, statusWord } from "~/kit/bits"
import { GlyphIcon, Icon, type Glyph } from "~/kit/icons"
import { memberOf, type Channel, type ChannelTile, type Issue, type Person, type PullRequest, type Task } from "~/model"
import { Face } from "~/shell/rail"

export interface Lookup {
  task: (id: number) => Task | undefined
  person: (key: string) => Person | undefined
  pr: (key: string) => PullRequest | undefined
  issue: (key: string) => Issue | undefined
  tile: (code: string) => ChannelTile | undefined
  stranger?: (name: string) => Stranger | undefined
  on?: (url: string) => boolean
  lead?: (url: string) => ReactNode | undefined
  trail?: (url: string) => ReactNode | undefined
  drag?: (url: string) => { onPointerDown: (e: PointerEvent) => void } | undefined
  fold?: (url: string, open: boolean) => string | undefined
}

export type Stranger = Pick<Person, "name" | "kind" | "harness" | "presence">

export const NOTHING: Lookup = { task: () => undefined, person: () => undefined, pr: () => undefined, issue: () => undefined, tile: () => undefined }

export const lookupOf = (channel: Channel): Lookup => ({
  ...NOTHING,
  task: (id) => channel.tasks.find((x) => x.id === id),
  person: (name) => memberOf(channel, name),
  pr: (key) => channel.prs?.find((p) => `${p.repo}/${p.number}` === key),
  issue: (key) => channel.issues?.find((i) => `${i.repo}/${i.number}` === key),
})

const ROW = /^kiwi-(?:task|msg|pr|issue|mention):|^kiwi-page:(?:channel|agent|spec):/
const DO = "kiwi-do:"
const BAR = "kiwi-bar"
const FIELD = "kiwi-field"
const FACE = "kiwi-face:"
const FOLD = "kiwi:fold"
const OPEN = "kiwi:open"
const COUNT = /^kiwi:n:(\d+)$/
const DIFF = "diff"

const TONES = new Set(["alert", "decide", "doing", "live", "review", "quiet"])
const MORE = ["tip", "label", "tone"] as const

export interface DoMore {
  tip?: string | undefined
  label?: string | undefined
  tone?: string | undefined
}

export interface Did extends DoMore {
  url: string
  act: boolean
}

export function doUrl(key: string, more: DoMore = {}): string {
  const query = new URLSearchParams(
    MORE.flatMap((name) => {
      const value = more[name]
      return value ? [[name, value]] : []
    })
  ).toString()
  return `${DO}${key}${query ? `?${query}` : ""}`
}

export function doOf(url: string): Did {
  if (!url.startsWith(DO)) return { url, act: false }
  const at = url.indexOf("?")
  const bare = at < 0 ? url : url.slice(0, at)
  const query = new URLSearchParams(at < 0 ? "" : url.slice(at + 1))
  const tone = query.get("tone") ?? ""
  return { url: bare, act: bare.length > DO.length, tip: query.get("tip") ?? undefined, label: query.get("label") ?? undefined, tone: TONES.has(tone) ? `tone-${tone}` : undefined }
}

const NAMED: Readonly<Record<string, string>> = { "-": "|&hyphen;|&dash;", ":": "|&colon;" }
const spelled = (c: string): string => {
  const n = c.charCodeAt(0)
  return `(?:${c.replace(/[-:]/, "\\$&")}|\\\\${/[a-z]/i.test(c) ? "(?!)" : c}|&#0*${n};|&#x0*${n.toString(16)};${NAMED[c] ?? ""})`
}
const ACTION = new RegExp([..."kiwi-do:"].map(spelled).join(""), "gi")

export const inert = (md: string): string => md.replace(ACTION, "kiwi-off:")

const PUNCT = /[!-/:-@[-`{-~]/g

export const esc = (text: string): string => inert(text).replace(/\s+/g, " ").trim().replace(PUNCT, "\\$&")

export const toned = (text: string, tone?: string, tip?: string): string => `[${esc(text)}](<${doUrl("", { tone: tone?.replace(/^tone-/, ""), tip })}>)`

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const BLOCK = /^( {0,3})(#|>|=+[ \t]*$|-+[ \t]*$)/

export function authored(md: string): string {
  let fence = ""
  return inert(md)
    .split("\n")
    .map((line) => {
      const opens = FENCE.exec(line)?.[1]
      if (fence) {
        if (opens && opens[0] === fence[0] && opens.length >= fence.length) fence = ""
        return line
      }
      if (opens) {
        fence = opens
        return line
      }
      return line.replace(BLOCK, "$1\\$2")
    })
    .join("\n")
}

export interface Seal {
  key: (run: () => void, more?: DoMore) => string
  owns: (url: string) => boolean
  run: (url: string) => void
}

export function seal(): Seal {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")
  const acts = new Map<string, () => void>()
  const find = (url: string): (() => void) | undefined => {
    const did = doOf(url)
    return did.act ? acts.get(did.url.slice(DO.length)) : undefined
  }
  return {
    key(run, more) {
      const key = `${token}-${acts.size}`
      acts.set(key, run)
      return doUrl(key, more)
    },
    owns: (url) => find(url) !== undefined,
    run: (url) => find(url)?.(),
  }
}

type Mark = (name: string) => ReactNode | undefined

const CHECKS = new Map<string, readonly [Glyph, string]>([
  ["check:pass", [CheckmarkCircle02Icon, "tone-live"]],
  ["check:fail", [CancelCircleIcon, "tone-alert"]],
  ["check:running", [Loading03Icon, "tone-doing"]],
  ["check:waiting", [CircleDashedIcon, "tone-quiet"]],
  ["check:skipped", [MinusSignCircleIcon, "tone-quiet"]],
])

function checkMark(name: string): ReactNode | undefined {
  const check = CHECKS.get(name)
  return check ? (
    <span className={check[1]}>
      <GlyphIcon glyph={check[0]} size={14} />
    </span>
  ) : undefined
}

const NO_MARK: Mark = () => undefined

export type Field = (name: string) => ReactNode | undefined

const NO_FIELD: Field = () => undefined

const textOf = (node: ASTNode): string => node.content ?? (node.children ?? []).map(textOf).join("")
const urlOf = (node: ASTNode | undefined): string => (node?.type === "Link" ? (node.attributes?.url ?? "") : "")
const isGap = (node: ASTNode): boolean => node.type === "SoftBreak" || node.type === "LineBreak" || (node.type === "Text" && !node.content?.trim())
const solid = (node: ASTNode | undefined): ASTNode[] => (node?.children ?? []).filter((c) => !isGap(c))
const after = (url: string, lead: string): string => decodeURIComponent(url.slice(lead.length))
const fieldName = (node: ASTNode): string | undefined => (node.type === "CodeBlock" && node.attributes?.language?.trim() === FIELD ? textOf(node).trim() : undefined)
const isFold = (node: ASTNode | undefined): boolean => {
  const first = node?.type === "Heading" && node.attributes?.level === "2" ? solid(node)[0] : undefined
  return first?.type === "Code" && textOf(first) === FOLD
}

export const face = (name: string): string => `${FACE}${encodeURIComponent(name)}`

const faceOf = (url: string): string | null => (url.startsWith(FACE) ? after(url, FACE) : null)

function segsOf(nodes: readonly ASTNode[]): ASTNode[][] {
  const segs: ASTNode[][] = [[]]
  for (const node of nodes) {
    if (node.type !== "Text") {
      segs.at(-1)?.push(node)
      continue
    }
    ;(node.content ?? "").split("·").forEach((part, i) => {
      if (i > 0) segs.push([])
      if (part.trim()) segs.at(-1)?.push({ ...node, content: part.trim() })
    })
  }
  return segs.filter((seg) => seg.length > 0)
}

function diffOf(text: string): { kind: string; lines: string[] }[] {
  const parts: { kind: string; lines: string[] }[] = []
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const c = line.charAt(0)
    const kind = c === "-" ? "is-gone" : c === "+" ? "is-new" : ""
    const shown = c === "-" || c === "+" || c === " " ? line.slice(1) : line
    const last = parts.at(-1)
    if (last?.kind === kind) last.lines.push(shown)
    else parts.push({ kind, lines: [shown] })
  }
  return parts
}

function actOf(node: ASTNode, didOf: (url: string) => Did): { did: Did; nodes: ASTNode[]; main: boolean } | null {
  const inner = node.type === "Strong" ? solid(node) : [node]
  const link = inner.length === 1 ? inner[0] : undefined
  const did = didOf(urlOf(link))
  return did.act ? { did, nodes: link?.children ?? [], main: node.type === "Strong" } : null
}

function personOf(url: string): string | null {
  if (url.startsWith("kiwi-mention:")) return after(url, "kiwi-mention:")
  return url.startsWith("kiwi-page:agent:") ? after(url, "kiwi-page:agent:") : null
}

function unled(nodes: readonly ASTNode[]): ASTNode[] {
  const [first, ...rest] = nodes
  if (first?.type !== "Text") return [...nodes]
  const content = (first.content ?? "").replace(/^\s*·\s*/, "")
  return content ? [{ ...first, content }, ...rest] : rest
}

const held = (e: MouseEvent) => e.preventDefault()
const spaced = (e: KeyboardEvent<HTMLAnchorElement>) => {
  if (e.key !== " " || e.repeat) return
  e.preventDefault()
  e.currentTarget.click()
}

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
    return (
      <>
        <Dot status={!task || task.cancelled ? "todo" : task.status} />
        {task && <span className="sr">{statusWord(task)}</span>}
      </>
    )
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

function Unfold({ first, label, meta, children }: { first: boolean; label: (open: boolean) => string; meta: ReactNode; children: (open: boolean, toggle: ReactNode) => ReactNode }) {
  const [open, setOpen] = useState(first)
  const toggle = (
    <button type="button" className="pg-meta pg-unfold num" aria-expanded={open} aria-label={label(open)} onClick={() => setOpen(!open)}>
      {meta}
      <Icon name="down" size={12} />
    </button>
  )
  return children(open, toggle)
}

const foldOf = (nodes: readonly ASTNode[]): { first: boolean | undefined; rest: ASTNode[] } => {
  const at = nodes.findIndex((n) => n.type === "Code" && (textOf(n) === FOLD || textOf(n) === OPEN))
  const mark = nodes[at]
  return at < 0 || !mark ? { first: undefined, rest: [...nodes] } : { first: textOf(mark) === OPEN, rest: nodes.filter((_, i) => i !== at) }
}

const NOT_OURS = (): boolean => false

export function pieces(find: Lookup, mark: Mark = NO_MARK, owns: (url: string) => boolean = NOT_OURS, field: Field = NO_FIELD): Draw {
  const didOf = (url: string): Did => {
    const did = doOf(url)
    return did.act && !owns(url) ? { url, act: false } : did
  }

  const open = (tools: DrawTools, url: string) => (e: MouseEvent) => {
    e.preventDefault()
    tools.press(url)
  }

  const head = (node: ASTNode, tools: DrawTools): ReactNode | undefined => {
    if (node.attributes?.level !== "3") return undefined
    const [first, ...rest] = solid(node)
    const url = urlOf(first)
    const who = faceOf(url)
    if (!first || !who) return undefined
    const segs = segsOf(rest)
    const last = segs.at(-1)
    const time = last?.every((n) => n.type === "Text") ? segs.pop() : undefined
    const tags: ReactNode[] = []
    const links: ReactNode[] = []
    const verbs: string[] = []
    segs.forEach((seg, i) => {
      const link = seg.length === 1 ? urlOf(seg[0]) : ""
      const did = doOf(link)
      if (link.startsWith(DO) && !did.act)
        tags.push(
          <span key={i} className={cx("pg-tag", did.tone)}>
            {textOf({ type: "Paragraph", children: seg })}
          </span>
        )
      else if (link)
        links.push(
          <a key={i} className="pg-head-link" href={link} onClick={open(tools, link)} onAuxClick={held}>
            {textOf({ type: "Paragraph", children: seg })}
          </a>
        )
      else verbs.push(textOf({ type: "Paragraph", children: seg }))
    })
    const person = find.person(who)
    const name = textOf(first).replace(/^@/, "")
    const avatar = <Avatar person={person ?? find.stranger?.(who)} size="sm" />
    const mention = `kiwi-mention:${encodeURIComponent(who)}`
    return (
      <header className="pg-head">
        {person ? (
          <a className="pg-head-who" href={mention} onClick={open(tools, mention)} onAuxClick={held}>
            {avatar}
            <span className="pg-head-name">{name}</span>
          </a>
        ) : (
          <span className="pg-head-who">
            {avatar}
            <span className="pg-head-name">{name}</span>
          </span>
        )}
        {tags}
        {verbs.length > 0 && <span className="pg-head-verb">{verbs.join(" · ")}</span>}
        {(links.length > 0 || time) && (
          <span className="pg-head-end">
            {links}
            {time && <span className="pg-head-time num">{textOf({ type: "Paragraph", children: time })}</span>}
          </span>
        )}
      </header>
    )
  }

  const markOf = (node: ASTNode | undefined): ReactNode | undefined => (node?.type === "Code" ? (checkMark(textOf(node)) ?? mark(textOf(node))) : undefined)

  const face = (nodes: readonly ASTNode[]): ReactNode => {
    const marks = nodes.map(markOf)
    if (marks.every((m) => m === undefined)) return textOf({ type: "Paragraph", children: [...nodes] })
    return nodes.map((n, i) => <Fragment key={i}>{marks[i] ?? textOf(n).trim()}</Fragment>)
  }

  const say = (nodes: readonly ASTNode[], tools: DrawTools): ReactNode =>
    nodes.map((node, i) => {
      const count = node.type === "Code" ? COUNT.exec(textOf(node)) : null
      if (count) return <Count key={i} n={Number(count[1])} loud />
      const url = urlOf(node)
      const who = personOf(url)
      if (who !== null)
        return (
          <a key={i} className="pg-who-link" href={url} onClick={open(tools, url)} onAuxClick={held}>
            <Avatar person={find.person(who)} size="sm" />
            <span className="pg-who-link-name">{textOf(node)}</span>
          </a>
        )
      const did = didOf(url)
      if (did.act)
        return (
          <button key={i} type="button" className="btn is-small is-quiet" title={did.tip} aria-label={did.label} onClick={() => tools.press(did.url)}>
            {face(node.children ?? [])}
          </button>
        )
      if (url.startsWith(DO) && !did.act)
        return (
          <span key={i} className={did.tone} title={did.tip}>
            {say(node.children ?? [], tools)}
          </span>
        )
      return <Fragment key={i}>{tools.inline({ type: "Paragraph", children: [node] })}</Fragment>
    })

  const headOf = (item: ASTNode) => {
    const [para, ...below] = item.children ?? []
    const kids = para?.type === "Paragraph" ? (para.children ?? []) : []
    const start = kids.findIndex((c) => !isGap(c))
    const lead = start < 0 ? undefined : markOf(kids[start])
    const at = lead === undefined ? start : kids.findIndex((c, i) => i > start && !isGap(c))
    return { lead, head: at < 0 ? undefined : kids[at], rest: at < 0 ? [] : kids.slice(at + 1), below }
  }

  const isRow = (item: ASTNode): boolean => {
    if (item.children?.[0]?.type !== "Paragraph") return false
    const { lead, head } = headOf(item)
    return lead === undefined ? ROW.test(urlOf(head)) : head?.type === "Link" || head?.type === "Code"
  }

  const row = (item: ASTNode, key: string | number, tools: DrawTools, inCard: boolean): ReactNode => {
    const { lead, head, rest, below } = headOf(item)
    const url = urlOf(head)
    const label = head ? textOf(head) : ""
    const cut = rest.findIndex((n) => n.type === "LineBreak" || n.type === "SoftBreak")
    const fold = foldOf(cut < 0 ? rest : rest.slice(0, cut))
    const more = unled(fold.rest)
    const line = cut < 0 ? [] : unled(rest.slice(cut + 1))
    const on = url !== "" && find.on?.(url) === true
    const inner = (
      <>
        <span className={cx("side-icon", url.startsWith("kiwi-page:channel:") && "side-face")}>{lead ?? find.lead?.(url) ?? <Lead url={url} find={find} />}</span>
        <span className="pg-name">{label}</span>
      </>
    )
    const meta = more.length > 0 ? say(more, tools) : null
    const draw = (shown: boolean, toggle: ReactNode) => (
      <li key={key} className={cx("pg-item", toggle !== null && shown && "is-open")}>
        <div className={cx("pg-row", line.length > 0 && "is-two", on && "is-on")}>
          {url ? (
            <a className="pg-main" href={url} title={label} aria-current={on || undefined} onClick={open(tools, url)} onKeyDown={spaced} onAuxClick={held} {...find.drag?.(url)}>
              {inner}
            </a>
          ) : (
            <span className="pg-main" title={label}>
              {inner}
            </span>
          )}
          {toggle ?? (meta !== null && <span className={cx("pg-meta num", toneOf(url, find))}>{meta}</span>)}
          {line.length > 0 && <span className="pg-line num">{say(line, tools)}</span>}
          {find.trail?.(url) ?? <Trail url={url} find={find} />}
        </div>
        {shown && below.length > 0 && (
          <div className="pg-nest">
            {below.map((b, i) => (
              <Fragment key={i}>{piece(b, i, below, tools, inCard) ?? tools.block(b, i)}</Fragment>
            ))}
          </div>
        )}
      </li>
    )
    if (fold.first === undefined || below.length === 0) return draw(true, null)
    return (
      <Unfold key={key} first={fold.first} label={(shown) => find.fold?.(url, shown) ?? `${textOf({ type: "Paragraph", children: more }).trim()} · ${label}`} meta={meta}>
        {draw}
      </Unfold>
    )
  }

  const keyed = (items: readonly ASTNode[]): (string | number)[] => {
    const seen = new Map<string, number>()
    return items.map((item, i) => {
      const url = urlOf(headOf(item).head)
      if (!url) return i
      const n = seen.get(url) ?? 0
      seen.set(url, n + 1)
      return `${url}#${n}`
    })
  }

  const piece = (node: ASTNode, at: number, all: readonly ASTNode[], tools: DrawTools, inCard: boolean): ReactNode | undefined => {
    if (node.type === "Heading") {
      const level = node.attributes?.level
      const [first, ...rest] = solid(node)
      const who = urlOf(first)
      const said = head(node, tools)
      if (said) return said
      if (isFold(node)) {
        const next = all[at + 1]
        return (
          <details key={`fold-${all.slice(0, at).filter(isFold).length}`} className="pg-fold">
            <summary>
              <Icon name="chevron" size={12} />
              {say(unled(rest), tools)}
            </summary>
            {next && (piece(next, at + 1, all, tools, inCard) ?? tools.block(next, at + 1))}
          </details>
        )
      }
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
      if (level === "2") {
        const segs = segsOf(solid(node))
        const tail = segs.length > 1 ? segs.at(-1) : undefined
        const count = tail?.length === 1 && tail[0]?.type === "Text" && /^\d+$/.test(tail[0].content ?? "") ? tail[0].content : undefined
        const toned = solid(node).some((k) => doOf(urlOf(k)).tone !== undefined)
        if (count === undefined && !toned) return <h2 className="pg-label">{tools.inline(node)}</h2>
        const words = count === undefined ? segs : segs.slice(0, -1)
        return (
          <h2 className="pg-label">
            {words.map((seg, i) => (
              <Fragment key={i}>
                {i > 0 && " · "}
                {say(seg, tools)}
              </Fragment>
            ))}
            {count !== undefined && <span className="pg-n num">{count}</span>}
          </h2>
        )
      }
      if (level === "3") return <h3 className={inCard ? "pg-card-title" : "pg-sub"}>{tools.inline(node)}</h3>
      return undefined
    }
    if (node.type === "Paragraph") {
      const kids = solid(node)
      const lone = kids.length === 1 ? doOf(urlOf(kids[0])) : undefined
      if (lone && lone.url === DO && lone.tone) return <p className={cx("pg-tone", lone.tone)}>{say(kids[0]?.children ?? [], tools)}</p>
      const acts = kids.map((k) => actOf(k, didOf))
      if (kids.length && acts.every(Boolean))
        return (
          <div className="pg-acts">
            {acts.map((a, i) => (
              <button key={i} type="button" className={cx("btn", a?.main && "is-primary")} title={a?.did.tip} aria-label={a?.did.label} onClick={() => a && tools.press(a.did.url)}>
                {a && face(a.nodes)}
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
      if (before?.type === "Heading" && before.attributes?.level === "1") return <p className="pg-facts">{say(node.children ?? [], tools)}</p>
      if (before?.type === "CodeBlock" && before.attributes?.language?.trim() === BAR) return <p className="pg-note">{tools.inline(node)}</p>
      return undefined
    }
    if (node.type === "UnorderedList" || node.type === "OrderedList") {
      const items = node.children ?? []
      const heads = items.map((item) => solid(item.children?.[0]))
      if (items.length && heads.every((h) => h.length === 1 && didOf(urlOf(h[0])).act))
        return (
          <div className="pg-opts">
            {heads.map((h, i) => (
              <button key={i} type="button" className="btn pg-opt" onClick={() => tools.press(didOf(urlOf(h[0])).url)}>
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
                <dd>{say(p?.rest ?? [], tools)}</dd>
              </Fragment>
            ))}
          </dl>
        )
      if (items.length && items.every(isRow)) {
        const keys = keyed(items)
        return <ul className="pg-rows">{items.map((item, i) => row(item, keys[i] ?? i, tools, inCard))}</ul>
      }
      return undefined
    }
    if (node.type === "Blockquote") {
      const kids = node.children ?? []
      if (inCard)
        return (
          <blockquote className="pg-quote">
            {kids.map((k, i) => (
              <Fragment key={i}>{k.type === "Paragraph" ? <p>{tools.inline(k)}</p> : (piece(k, i, kids, tools, true) ?? tools.block(k, i))}</Fragment>
            ))}
          </blockquote>
        )
      const names = kids.map((k) => {
        const name = fieldName(k)
        return name !== undefined && field(name) !== undefined ? name : undefined
      })
      const own = names.find((name) => name !== undefined)
      const first = kids[0]
      const said = first?.type === "Heading" && first.attributes?.level === "3" && faceOf(urlOf(solid(first)[0])) !== null
      return (
        <section key={own === undefined ? undefined : `card:${own}`} className={cx("pg-card", said && "is-said")}>
          {kids.map((k, i) => (
            <Fragment key={names[i] === undefined ? i : `f:${names[i]}`}>{piece(k, i, kids, tools, true) ?? tools.block(k, i)}</Fragment>
          ))}
        </section>
      )
    }
    const named = fieldName(node)
    if (named !== undefined) {
      const drawn = field(named)
      if (drawn !== undefined) return <Fragment key={`f:${named}`}>{drawn}</Fragment>
    }
    if (node.type === "CodeBlock" && node.attributes?.language?.trim() === DIFF)
      return (
        <div className="pg-code">
          {diffOf(textOf(node)).map((part, i) => (
            <pre key={i} className={cx("pg-code-part", part.kind)}>
              {part.lines.join("\n")}
            </pre>
          ))}
        </div>
      )
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

  return (node, at, all, tools) => (isFold(all[at - 1]) ? null : piece(node, at, all, tools, false))
}
