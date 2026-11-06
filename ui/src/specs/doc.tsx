import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"

import { useNames, useTaskIds } from "~/chat/conversation"
import { Body } from "~/chat/body"
import { type Words, wordsPlain, wordsRaw, wrote } from "~/words"
import { Avatar, cx } from "~/kit/bits"
import { clock } from "~/kit/time"
import type { Channel, Spec, Where } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { commentsOf, faceOf, lineDiff, quoteIn, type Comment } from "~/specs/read"

const WIDE_PX = 940
const TALK_SHOWN = 3
const DIFF_CONTEXT = 1
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

function shownText(spec: Spec): Words {
  const lines = wordsRaw(spec.text).split("\n")
  const first = lines.findIndex((l) => l.trim() !== "")
  return first >= 0 && /^#\s+/.test(lines[first]!) && lines[first]!.replace(/^#\s+/, "").trim() === wordsRaw(spec.title)
    ? wrote(
        lines
          .slice(first + 1)
          .join("\n")
          .trim()
      )
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
  const comments = commentsOf(channel, spec)
  const wrap = useRef<HTMLDivElement>(null)
  const doc = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const readUp = useRef(false)
  const opened = useRef<number | null>(null)
  const [wide, setWide] = useState(true)
  const [tops, setTops] = useState<ReadonlyMap<number, number>>(new Map())
  const [hot, setHot] = useState<number | null>(null)
  const [pop, setPop] = useState<{ text: string; top: number } | null>(null)
  const [draft, setDraft] = useState<{ quote: string } | null>(null)
  const [diff, setDiff] = useState(!!spec.changed)
  const [allTalk, setAllTalk] = useState(false)
  const anchored = comments.filter((c) => c.quote && tops.has(c.m.seq)).sort((a, b) => (tops.get(a.m.seq) ?? 0) - (tops.get(b.m.seq) ?? 0))
  const loose = comments.filter((c) => !c.quote || !tops.has(c.m.seq) || !wide)
  const key = `${wordsRaw(spec.text)}\n${comments.map((c) => `${c.m.seq}:${c.quote ?? ""}`).join("\n")}`

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
      const base = el.getBoundingClientRect().top
      const next = new Map<number, number>()
      for (const c of commentsOf(channel, spec)) {
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
  }, [key, editing, channel, spec, wide, diff])

  useLayoutEffect(() => {
    const el = wrap.current
    const page = el?.closest<HTMLElement>(".spec-page")
    if (!el || !page) return
    const fit = new ResizeObserver(() => el.style.setProperty("--page-h", `${page.clientHeight}px`))
    fit.observe(page)
    return () => fit.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = scroll.current
    if (opened.current !== spec.ask) {
      opened.current = spec.ask
      readUp.current = false
    }
    if (el && !readUp.current) el.scrollTop = el.scrollHeight
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
    setPop({ text: text.slice(0, 400), top: rect.top - el.getBoundingClientRect().top })
  }, [])

  const toLine = (seq: number): void => {
    const lines = [...(doc.current?.querySelectorAll<HTMLElement>("[data-anchor]") ?? [])]
    lines.find((b) => (b.dataset.anchor ?? "").split(" ").includes(String(seq)))?.scrollIntoView({ block: "center" })
    setHot(seq)
  }

  if (editing) return <Editor channel={channel} spec={spec} onDone={() => onEditing(false)} />

  const boxes = (
    <>
      {draft && <CommentBox channel={channel} spec={spec} quote={draft.quote} onDone={() => setDraft(null)} />}
      <CommentBox channel={channel} spec={spec} />
    </>
  )

  const talk = (
    <section className="spec-talk" aria-label="Comments on the whole spec">
      <h2 className="spec-talk-h">
        {loose.length ? `${loose.length} ${loose.length === 1 ? "comment" : "comments"}` : "Comments"}
        {loose.length > TALK_SHOWN && (
          <button type="button" className="btn is-quiet is-small" aria-expanded={allTalk} onClick={() => setAllTalk(!allTalk)}>
            {allTalk ? "Latest only" : `All ${loose.length}`}
          </button>
        )}
      </h2>
      {loose.length > 0 && (
        <ul className="spec-comments">
          {(allTalk ? loose : loose.slice(-TALK_SHOWN)).map((c) => (
            <CommentItem key={c.m.seq} channel={channel} c={c} names={names} tasks={tasks} showQuote />
          ))}
        </ul>
      )}
      {!wide && boxes}
    </section>
  )

  return (
    <div ref={wrap} className={cx("spec-doc-wrap", wide && "is-wide")}>
      <div className="spec-doc-col">
        {spec.changed && spec.approved && (
          <div className="spec-diff-bar">
            <button type="button" className="btn is-quiet is-small" aria-expanded={diff} onClick={() => setDiff(!diff)}>
              {diff ? "Hide the changes" : "Show the changes"}
            </button>
          </div>
        )}
        {diff && spec.approved && <Diff before={wordsPlain(spec.approved.text, channel.nicknames)} after={wordsPlain(spec.text, channel.nicknames)} />}
        <div ref={doc} className="spec-doc" onMouseUp={picked} onKeyUp={picked}>
          <Body text={shownText(spec)} seq={spec.ask} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />
          {pop && (
            <button
              type="button"
              className="spec-pop"
              style={{ top: Math.max(0, pop.top - 40) }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setDraft({ quote: pop.text })
                setPop(null)
                window.getSelection()?.removeAllRanges()
              }}
            >
              Comment
            </button>
          )}
        </div>
        {!wide && talk}
      </div>
      {wide && (
        <aside className="spec-rail" aria-label="Comments">
          <div
            ref={scroll}
            className="spec-rail-scroll"
            onScroll={(e) => {
              const el = e.currentTarget
              readUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - 4
            }}
          >
            {anchored.length > 0 && (
              <ul className="spec-rail-lines" aria-label="Comments on lines of the spec">
                {anchored.map((c) => (
                  <li key={c.m.seq} className={cx("spec-rail-item", hot === c.m.seq && "is-hot")} onMouseEnter={() => setHot(c.m.seq)} onMouseLeave={() => setHot(null)}>
                    <CommentItem channel={channel} c={c} names={names} tasks={tasks} onQuote={() => toLine(c.m.seq)} />
                  </li>
                ))}
              </ul>
            )}
            {talk}
          </div>
          <div className="spec-rail-foot">{boxes}</div>
        </aside>
      )}
    </div>
  )
}

function CommentItem({
  channel,
  c,
  names,
  tasks,
  showQuote,
  onQuote,
}: {
  channel: Channel
  c: Comment
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  showQuote?: boolean
  onQuote?: () => void
}) {
  return (
    <article className={cx("spec-comment", c.m.pending && "is-pending")}>
      <header className="spec-comment-head">
        <Avatar person={faceOf(channel, c.m.from)} size="sm" />
        <span className="spec-comment-name">{nickname(channel, c.m.from)}</span>
        <time className="spec-comment-time">{clock(c.m.at)}</time>
      </header>
      {showQuote && c.quote && <p className="spec-comment-quote">{c.quote}</p>}
      {onQuote && c.quote && (
        <button type="button" className="spec-comment-quote is-link" title="Show this line in the spec" onClick={onQuote}>
          <span>{c.quote}</span>
        </button>
      )}
      <Body text={wrote(c.text)} seq={c.m.seq} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />
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
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
  }, [text])
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
  if (!quote)
    return (
      <div className="spec-box-new">
        <textarea
          ref={box}
          className="textarea spec-box-text"
          rows={1}
          value={text}
          placeholder="Comment"
          title="Or select words in the spec to comment on them"
          aria-label="Comment on the spec"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={keys}
        />
        {text.trim() && (
          <div className="spec-box-foot">
            <button type="button" className="btn" onClick={send}>
              Comment
            </button>
          </div>
        )}
      </div>
    )
  return (
    <div className="spec-box-new is-anchored">
      <p className="spec-comment-quote">{quote}</p>
      <textarea
        ref={box}
        className="textarea spec-box-text"
        rows={3}
        value={text}
        placeholder="Say what's off, or ask about it"
        aria-label="Comment on the selected words"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <div className="spec-box-foot">
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
  const [whole, setWhole] = useState(false)
  const lines = lineDiff(before, after)
  const near = lines.map((_, i) => lines.slice(Math.max(0, i - DIFF_CONTEXT), i + DIFF_CONTEXT + 1).some((l) => l.kind !== "same"))
  const rows: ({ kind: "line"; i: number } | { kind: "gap"; from: number; n: number })[] = []
  lines.forEach((_, i) => {
    if (whole || near[i]) return void rows.push({ kind: "line", i })
    const last = rows.at(-1)
    if (last?.kind === "gap") last.n += 1
    else rows.push({ kind: "gap", from: i, n: 1 })
  })
  return (
    <ol className="spec-diff" aria-label="What changed since it was approved">
      {rows.map((r) => {
        if (r.kind === "gap")
          return (
            <li key={`gap-${r.from}`} className="spec-diff-line is-gap">
              <button type="button" className="spec-diff-gap" onClick={() => setWhole(true)}>
                ⋯ {r.n} unchanged {r.n === 1 ? "line" : "lines"}
              </button>
            </li>
          )
        const l = lines[r.i]!
        return (
          <li key={r.i} className={cx("spec-diff-line", `is-${l.kind}`)}>
            <span className="spec-diff-sign" aria-hidden="true">
              {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
            </span>
            <span className="spec-diff-text">{l.text || " "}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Editor({ channel, spec, onDone }: { channel: Channel; spec: Spec; onDone: () => void }) {
  const { actions } = useAct()
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const [text, setText] = useState(wordsRaw(spec.text))
  const [base] = useState(spec.v)
  const moved = spec.v !== base
  const save = () => {
    if (text.trim() && text.trim() !== wordsRaw(spec.text).trim()) actions.writeSpec(channel.code, spec.ask, text)
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
        <span className="spec-editor-hint">⌘S saves · Esc cancels</span>
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
          <Body text={wrote(text)} seq={spec.ask} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />
        </div>
      </div>
    </div>
  )
}
