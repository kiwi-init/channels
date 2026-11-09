import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"

import { useNames, useTaskIds } from "~/chat/conversation"
import { Body } from "~/chat/body"
import { MessageImages } from "~/chat/message"
import { preview } from "~/chat/preview"
import { QuotePick } from "~/chat/quote-pick"
import { jumpTo } from "~/chat/reply"
import { type Words, wordsPlain, wordsRaw, wrote } from "~/words"
import { t } from "~/i18n/i18n"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { clock } from "~/kit/time"
import type { Channel, Spec } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { commentsOf, faceOf, lineDiff, quoteIn, splitQuote, type Comment } from "~/specs/read"
import { CommentBox, type CommentReply } from "~/specs/comment-box"

const WIDE_PX = 940
const TALK_SHOWN = 3
const DIFF_CONTEXT = 1
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre"
const COMMENT_TEXT = ".spec-comment .md"

const openImage = (url: string) => void window.open(url, "_blank", "noopener,noreferrer")

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
  const [reply, setReply] = useState<CommentReply | null>(null)
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
        if (!c.quote || c.re !== undefined) continue
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

  const replyTo = useCallback(
    (seq: number, excerpt: string | null = null) => {
      const to = channel.messages.find((m) => m.seq === seq)
      if (to) setReply({ to, excerpt })
    },
    [channel.messages]
  )

  const toComment = (seq: number): void => {
    if (jumpTo(wrap.current, seq)) return
    setAllTalk(true)
    requestAnimationFrame(() => jumpTo(wrap.current, seq))
  }

  if (editing) return <Editor channel={channel} spec={spec} onDone={() => onEditing(false)} />

  const said = (c: Comment) => {
    const re = c.re
    return <CommentItem key={c.m.seq} channel={channel} c={c} names={names} tasks={tasks} showQuote onReply={() => replyTo(c.m.seq)} {...(re === undefined ? {} : { onRe: () => toComment(re) })} />
  }

  const boxes = (
    <>
      {draft && <CommentBox channel={channel} spec={spec} quote={draft.quote} onDone={() => setDraft(null)} />}
      <CommentBox channel={channel} spec={spec} reply={reply} onUnreply={() => setReply(null)} />
    </>
  )

  const talk = (
    <section className="spec-talk" aria-label={t("specs.doc.talk.label")}>
      <h2 className="spec-talk-h">
        {loose.length ? t("specs.doc.comments.count", { count: loose.length }) : t("specs.doc.comments")}
        {loose.length > TALK_SHOWN && (
          <button type="button" className="btn is-quiet is-small" aria-expanded={allTalk} onClick={() => setAllTalk(!allTalk)}>
            {allTalk ? t("specs.doc.latest.only") : t("specs.doc.all", { count: loose.length })}
          </button>
        )}
      </h2>
      {loose.length > 0 && <ul className="spec-comments">{(allTalk ? loose : loose.slice(-TALK_SHOWN)).map(said)}</ul>}
      {!wide && boxes}
    </section>
  )

  return (
    <div ref={wrap} className={cx("spec-doc-wrap", wide && "is-wide")}>
      <QuotePick root={wrap} body={COMMENT_TEXT} onQuote={replyTo} />
      <div className="spec-doc-col">
        {spec.changed && spec.approved && (
          <div className="spec-diff-bar">
            <button type="button" className="btn is-quiet is-small" aria-expanded={diff} onClick={() => setDiff(!diff)}>
              {diff ? t("specs.doc.hide.changes") : t("specs.doc.show.changes")}
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
              {t("specs.doc.comment")}
            </button>
          )}
        </div>
        {!wide && talk}
      </div>
      {wide && (
        <aside className="spec-rail" aria-label={t("specs.doc.comments")}>
          <div
            ref={scroll}
            className="spec-rail-scroll"
            onScroll={(e) => {
              const el = e.currentTarget
              readUp.current = el.scrollTop + el.clientHeight < el.scrollHeight - 4
            }}
          >
            {anchored.length > 0 && (
              <ul className="spec-rail-lines" aria-label={t("specs.doc.line.comments")}>
                {anchored.map((c) => (
                  <li key={c.m.seq} className={cx("spec-rail-item", hot === c.m.seq && "is-hot")} onMouseEnter={() => setHot(c.m.seq)} onMouseLeave={() => setHot(null)}>
                    <CommentItem channel={channel} c={c} names={names} tasks={tasks} onQuote={() => toLine(c.m.seq)} onReply={() => replyTo(c.m.seq)} />
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
  onReply,
  onRe,
}: {
  channel: Channel
  c: Comment
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  showQuote?: boolean
  onQuote?: () => void
  onReply?: () => void
  onRe?: () => void
}) {
  const to = c.re === undefined ? undefined : channel.messages.find((m) => m.seq === c.re)
  return (
    <article className={cx("spec-comment", c.m.pending && "is-pending")} data-seq={c.m.seq}>
      <header className="spec-comment-head">
        <Avatar person={faceOf(channel, c.m.from)} size="sm" />
        <span className="spec-comment-name">{nickname(channel, c.m.from)}</span>
        <time className="spec-comment-time">{clock(c.m.at)}</time>
        {onReply && !c.m.pending && (
          <button type="button" className="spec-comment-reply" aria-label={t("specs.doc.reply")} title={t("specs.doc.reply")} onClick={onReply}>
            <Icon name="reply" size={13} />
          </button>
        )}
      </header>
      {to && onRe && (
        <button type="button" className="spec-comment-quote is-link" title={t("specs.doc.show.comment")} onClick={onRe}>
          <span>
            <b>{nickname(channel, to.from)}</b> {c.excerpt ? `“${preview(c.excerpt)}”` : preview(splitQuote(wordsRaw(to.text)).text)}
          </span>
        </button>
      )}
      {showQuote && c.quote && <p className="spec-comment-quote">{c.quote}</p>}
      {onQuote && c.quote && (
        <button type="button" className="spec-comment-quote is-link" title={t("specs.doc.show.line")} onClick={onQuote}>
          <span>{c.quote}</span>
        </button>
      )}
      {c.text.trim() && <Body text={wrote(c.text)} seq={c.m.seq} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />}
      {c.m.images && <MessageImages code={channel.code} images={c.m.images} open={openImage} />}
    </article>
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
    <ol className="spec-diff" aria-label={t("specs.doc.diff.label")}>
      {rows.map((r) => {
        if (r.kind === "gap")
          return (
            <li key={`gap-${r.from}`} className="spec-diff-line is-gap">
              <button type="button" className="spec-diff-gap" onClick={() => setWhole(true)}>
                {t("specs.doc.unchanged", { count: r.n })}
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
        <span className="spec-editor-hint">{t("specs.doc.editor.hint")}</span>
        {moved && <span className="tone-decide spec-editor-moved">{t("specs.doc.editor.moved", { who: nickname(channel, spec.edited.by) })}</span>}
        <button type="button" className="btn is-quiet" onClick={onDone}>
          {t("specs.doc.cancel")}
        </button>
        <button type="button" className="btn is-primary" disabled={!text.trim()} onClick={save}>
          {t("specs.doc.save")}
        </button>
      </div>
      <div className="spec-editor-panes">
        <textarea className="textarea is-mono spec-source" value={text} spellCheck aria-label={t("specs.doc.source")} onChange={(e) => setText(e.target.value)} onKeyDown={keys} />
        <div className="spec-preview" aria-label={t("specs.doc.preview")}>
          <Body text={wrote(text)} seq={spec.ask} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />
        </div>
      </div>
    </div>
  )
}
