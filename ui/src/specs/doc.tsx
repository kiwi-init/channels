import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"

import { useNames, useTaskIds } from "~/chat/conversation"
import { Body } from "~/chat/message"
import { Avatar, cx } from "~/kit/bits"
import { clock } from "~/kit/time"
import type { Channel, Spec, Where } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { commentsOf, faceOf, lineDiff, quoteIn, type Comment } from "~/specs/read"

const WIDE_PX = 940
const RAIL_GAP = 8
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre"

const openImage = (url: string) => void window.open(url, "_blank", "noopener,noreferrer")

function whereOf(channel: Channel, ask: number): Where {
  return channel.messages.find((m) => m.seq === ask)?.where ?? { kind: "room", room: "general" }
}

function quoted(quote: string, text: string): string {
  return `${quote
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}\n\n${text.trim()}`
}

function shownText(spec: Spec): string {
  const lines = spec.text.split("\n")
  const first = lines.findIndex((l) => l.trim() !== "")
  return first >= 0 && /^#\s+/.test(lines[first]!) && lines[first]!.replace(/^#\s+/, "").trim() === spec.title
    ? lines
        .slice(first + 1)
        .join("\n")
        .trim()
    : spec.text
}

function anchorOf(blocks: HTMLElement[], quote: string): HTMLElement | undefined {
  const first = quote.split("\n")[0] ?? quote
  for (const q of [quote, first]) {
    const hits = blocks.filter((b) => quoteIn(b.textContent ?? "", q))
    if (hits.length) return hits.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0]
  }
  return undefined
}

export function SpecDoc({ channel, spec, editing, onEditing }: { channel: Channel; spec: Spec; editing: boolean; onEditing: (on: boolean) => void }) {
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const comments = commentsOf(channel, spec.ask)
  const wrap = useRef<HTMLDivElement>(null)
  const doc = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(true)
  const [tops, setTops] = useState<ReadonlyMap<number, number>>(new Map())
  const [hot, setHot] = useState<number | null>(null)
  const [pop, setPop] = useState<{ text: string; top: number; at: number } | null>(null)
  const [draft, setDraft] = useState<{ quote: string; top: number } | null>(null)
  const [diff, setDiff] = useState(!!spec.changed)
  const anchored = comments.filter((c) => c.quote && tops.has(c.m.seq))
  const loose = comments.filter((c) => !c.quote || !tops.has(c.m.seq) || !wide)
  const key = `${spec.text}\n${comments.map((c) => `${c.m.seq}:${c.quote ?? ""}`).join("\n")}`

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const watch = new ResizeObserver(() => setWide(el.clientWidth >= WIDE_PX))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = doc.current
    if (!el || editing) return
    const measure = () => {
      const blocks = [...el.querySelectorAll<HTMLElement>(BLOCKS)]
      for (const b of blocks) delete b.dataset.anchor
      const base = (rail.current ?? el).getBoundingClientRect().top
      const next = new Map<number, number>()
      for (const c of commentsOf(channel, spec.ask)) {
        if (!c.quote) continue
        const hit = anchorOf(blocks, c.quote)
        if (!hit) continue
        hit.dataset.anchor = hit.dataset.anchor ? `${hit.dataset.anchor} ${c.m.seq}` : String(c.m.seq)
        next.set(c.m.seq, hit.getBoundingClientRect().top - base)
      }
      setTops((was) => (was.size === next.size && [...next].every(([k, v]) => was.get(k) === v) ? was : next))
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [key, editing, channel, spec.ask, wide, diff])

  useLayoutEffect(() => {
    const el = rail.current
    if (!el) return
    let floor = 0
    const items = [...el.querySelectorAll<HTMLElement>("[data-at]")].sort((a, b) => Number(a.dataset.at) - Number(b.dataset.at))
    for (const item of items) {
      const top = Math.max(Number(item.dataset.at), floor)
      item.style.top = `${top}px`
      floor = top + item.offsetHeight + RAIL_GAP
    }
    el.style.minHeight = `${floor}px`
  })

  useEffect(() => {
    const el = doc.current
    if (!el) return
    for (const b of el.querySelectorAll<HTMLElement>("[data-anchor]")) b.classList.toggle("is-hot", hot !== null && (b.dataset.anchor ?? "").split(" ").includes(String(hot)))
  }, [hot, tops])

  const picked = useCallback(() => {
    const el = doc.current
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ""
    if (!el || !sel || !text || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return setPop(null)
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setPop({ text: text.slice(0, 400), top: rect.top - el.getBoundingClientRect().top, at: rect.top - (rail.current ?? el).getBoundingClientRect().top })
  }, [])

  if (editing) return <Editor channel={channel} spec={spec} onDone={() => onEditing(false)} />

  return (
    <div ref={wrap} className={cx("spec-doc-wrap", wide && "is-wide")}>
      <div className="spec-doc-col">
        {spec.changed && spec.approved && (
          <div className="spec-diff-bar">
            <span className="tone-decide">Changed since it was approved</span>
            <button type="button" className="btn is-quiet is-small" aria-expanded={diff} onClick={() => setDiff(!diff)}>
              {diff ? "Hide the changes" : "Show the changes"}
            </button>
          </div>
        )}
        {diff && spec.approved && <Diff before={spec.approved.text} after={spec.text} />}
        <div ref={doc} className="spec-doc" onMouseUp={picked} onKeyUp={picked}>
          <Body text={shownText(spec)} seq={spec.ask} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />
          {pop && (
            <button
              type="button"
              className="spec-pop"
              style={{ top: Math.max(0, pop.top - 40) }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft({ quote: pop.text, top: pop.at })
                setPop(null)
                window.getSelection()?.removeAllRanges()
              }}
            >
              Comment
            </button>
          )}
        </div>
        <section className="spec-talk" aria-label="Comments on the whole spec">
          <h2 className="spec-talk-h">
            {loose.length ? `${loose.length} ${loose.length === 1 ? "comment" : "comments"}` : "Comments"}
            <span className="dimmer"> · select any words in the spec to comment on them</span>
          </h2>
          <ul className="spec-comments">
            {loose.map((c) => (
              <CommentItem key={c.m.seq} channel={channel} c={c} names={names} tasks={tasks} showQuote />
            ))}
          </ul>
          {draft && !wide && <CommentBox channel={channel} spec={spec} quote={draft.quote} onDone={() => setDraft(null)} />}
          <CommentBox channel={channel} spec={spec} />
        </section>
      </div>
      {wide && (
        <aside ref={rail} className="spec-rail" aria-label="Comments on lines of the spec">
          {anchored.map((c) => (
            <div key={c.m.seq} className={cx("spec-rail-item", hot === c.m.seq && "is-hot")} data-at={tops.get(c.m.seq)} onMouseEnter={() => setHot(c.m.seq)} onMouseLeave={() => setHot(null)}>
              <CommentItem channel={channel} c={c} names={names} tasks={tasks} />
            </div>
          ))}
          {draft && (
            <div className="spec-rail-item is-draft" data-at={draft.top}>
              <CommentBox channel={channel} spec={spec} quote={draft.quote} onDone={() => setDraft(null)} />
            </div>
          )}
        </aside>
      )}
    </div>
  )
}

function CommentItem({ channel, c, names, tasks, showQuote }: { channel: Channel; c: Comment; names: ReadonlyMap<string, string>; tasks: ReadonlySet<number>; showQuote?: boolean }) {
  return (
    <article className={cx("spec-comment", c.m.pending && "is-pending")}>
      <header className="spec-comment-head">
        <Avatar person={faceOf(channel, c.m.from)} size="sm" />
        <span className="spec-comment-name">{nickname(channel, c.m.from)}</span>
        <time className="spec-comment-time">{clock(c.m.at)}</time>
      </header>
      {showQuote && c.quote && <p className="spec-comment-quote">{c.quote}</p>}
      <Body text={c.text} seq={c.m.seq} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />
    </article>
  )
}

function CommentBox({ channel, spec, quote, onDone }: { channel: Channel; spec: Spec; quote?: string; onDone?: () => void }) {
  const { actions } = useAct()
  const [text, setText] = useState("")
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (quote) box.current?.focus()
  }, [quote])
  const send = () => {
    if (!text.trim()) return
    actions.send(channel.code, whereOf(channel, spec.ask), quote ? quoted(quote, text) : text.trim(), { inThread: spec.ask })
    setText("")
    onDone?.()
  }
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send()
    }
    if (e.key === "Escape" && onDone) {
      e.preventDefault()
      onDone()
    }
  }
  return (
    <div className={cx("spec-box-new", quote && "is-anchored")}>
      {quote && <p className="spec-comment-quote">{quote}</p>}
      <textarea
        ref={box}
        className="textarea spec-box-text"
        rows={quote ? 3 : 2}
        value={text}
        placeholder={quote ? "Say what's off, or ask about it" : "Comment on the spec. Agents read it too."}
        aria-label={quote ? "Comment on the selected words" : "Comment on the spec"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <div className="spec-box-foot">
        <span className="spec-box-hint">⌘↩ sends</span>
        {onDone && (
          <button type="button" className="btn is-quiet is-small" onClick={onDone}>
            Cancel
          </button>
        )}
        <button type="button" className="btn is-small" disabled={!text.trim()} onClick={send}>
          Comment
        </button>
      </div>
    </div>
  )
}

function Diff({ before, after }: { before: string; after: string }) {
  const lines = lineDiff(before, after)
  return (
    <ol className="spec-diff" aria-label="What changed since it was approved">
      {lines.map((l, i) => (
        <li key={i} className={cx("spec-diff-line", `is-${l.kind}`)}>
          <span className="spec-diff-sign" aria-hidden="true">
            {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
          </span>
          <span className="spec-diff-text">{l.text || " "}</span>
        </li>
      ))}
    </ol>
  )
}

function Editor({ channel, spec, onDone }: { channel: Channel; spec: Spec; onDone: () => void }) {
  const { actions } = useAct()
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const [text, setText] = useState(spec.text)
  const [base] = useState(spec.v)
  const moved = spec.v !== base
  const save = () => {
    if (text.trim() && text.trim() !== spec.text.trim()) actions.writeSpec(channel.code, spec.ask, text)
    onDone()
  }
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key.toLowerCase() === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      save()
    }
    if (e.key === "Escape") {
      e.preventDefault()
      onDone()
    }
  }
  return (
    <div className="spec-editor">
      <div className="spec-editor-bar">
        <span className="spec-editor-kind">Markdown</span>
        <span className="spec-editor-hint">⌘S saves · Esc cancels · boxes under “## Done when” are what a person checks</span>
        {moved && <span className="tone-decide spec-editor-moved">{nickname(channel, spec.edited.by)} saved a newer version while you edited: saving replaces it.</span>}
        <button type="button" className="btn is-quiet" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn is-primary" disabled={!text.trim()} onClick={save}>
          Save
        </button>
      </div>
      <div className="spec-editor-panes">
        <textarea className="textarea is-mono spec-source" value={text} spellCheck aria-label="The spec, in markdown" onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
        <div className="spec-preview" aria-label="Preview">
          <Body text={text} seq={spec.ask} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />
        </div>
      </div>
    </div>
  )
}
