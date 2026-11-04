import "~/styles/thread-doc.css"

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react"
import { createPortal } from "react-dom"
import type { Node } from "prosemirror-model"
import { EditorState, Plugin, type Transaction } from "prosemirror-state"
import { Decoration, DecorationSet, EditorView, type NodeView } from "prosemirror-view"
import { yCursorPlugin, ySyncPlugin, ySyncPluginKey, yUndoPlugin } from "y-prosemirror"
import * as Y from "yjs"

import { attach, backInDraft, blockAt, blocks, continues, dropEmptyOwn, isEmpty, noteMade, replyIn, startBlock, unreply, type Made } from "~/chat/doc/blocks"
import { caretShown } from "~/chat/doc/carets"
import { onGiveBack } from "~/chat/doc/give-back"
import { writeOwnLinesOnly } from "~/chat/doc/own-writes"
import { keepScreenSelection, withScreenSelection } from "~/chat/doc/screen-selection"
import { attachTo, attachToDoc, startUpload, uploadTarget } from "~/chat/doc/uploads"
import { docKeys, type CommandFor } from "~/chat/doc/keys"
import { docTag, holdDoc, LiveDoc, type Shared } from "~/chat/doc/live"
import { noteTyping, setTypingFocus, tracingTyping, type TypingFocus } from "~/kit/typing-hook"
import { linksPlugin } from "~/chat/doc/links"
import { fileDrag, takeDropped } from "@kiwi/app/dropped.ts"
import { emptyPaste, takePasted } from "@kiwi/app/pasted.ts"
import { fileView, filesIn, imageView, uploadAll, type DocMedia } from "~/chat/doc/media"
import { blocksOf, richBlocks } from "@kiwi/core/doc/blocks.ts"
import { DOC_LEVEL, onWriterFloor, writerFloor } from "@kiwi/core/doc/level.ts"
import { docFeed, oldestAt, setDocFeed } from "~/chat/doc/finished"
import { postedBlocks } from "~/chat/doc/posted"
import { markdownRules } from "~/chat/doc/rules"
import { attrsOf, FRAGMENT, isBack, isSent, schema, type BlockAttrs } from "~/chat/doc/schema"
import { dismiss, menuKey, suggestPlugin, type Query } from "~/chat/doc/suggest"
import { matchCommands, parseCommand, type Command } from "~/chat/commands"
import { tooLong } from "~/chat/drafts"
import { startEditing } from "~/chat/editing"
import { withNames } from "~/chat/linked"
import { peopleMatches, taskMatches } from "~/chat/matches"
import { withExcerpt } from "~/chat/quote"
import { preview, useReplying } from "~/chat/reply"
import { useCommands } from "~/chat/use-commands"
import { Icon } from "~/kit/icons"
import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { clock } from "~/kit/time"
import { announce } from "~/kit/toasts"
import type { Channel, Message, Person, QuestionAsk, Task, Where } from "~/model"
import { nickname } from "~/names"
import { sameWhere, useAct, useApp } from "~/nav"

const QuestionCard = lazy(() => import("~/chat/question-card"))

const IDLE_MS = 4000
const SEND_KEYS = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘↩" : "Ctrl+Enter"

type HeadList = readonly (readonly [HTMLElement, number, BlockAttrs])[]

class Heads {
  private all = new Map<HTMLElement, { key: number; attrs: BlockAttrs }>()
  private list: HeadList = []
  private heard = new Set<() => void>()
  private next = 0
  private queued = false

  set(el: HTMLElement, attrs: BlockAttrs): void {
    const was = this.all.get(el)
    if (
      was &&
      was.attrs.id === attrs.id &&
      was.attrs.author === attrs.author &&
      was.attrs.kind === attrs.kind &&
      was.attrs.at === attrs.at &&
      was.attrs.re === attrs.re &&
      was.attrs.quote === attrs.quote
    )
      return
    this.all.set(el, { key: was?.key ?? this.next++, attrs })
    this.changed()
  }

  drop(el: HTMLElement): void {
    if (this.all.delete(el)) this.changed()
  }

  subscribe = (f: () => void): (() => void) => {
    this.heard.add(f)
    return () => this.heard.delete(f)
  }

  snapshot = (): HeadList => this.list

  private changed(): void {
    if (this.queued) return
    this.queued = true
    queueMicrotask(() => {
      this.queued = false
      this.list = [...this.all].map(([el, v]) => [el, v.key, v.attrs] as const)
      for (const f of this.heard) f()
    })
  }
}

class BlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private head: HTMLElement
  private foot: HTMLElement

  constructor(
    public node: Node,
    private heads: Heads,
    private feet: Heads,
    private shown: Map<HTMLElement, BlockView>
  ) {
    this.dom = document.createElement("section")
    this.dom.className = "blk"
    this.head = document.createElement("div")
    this.head.className = "blk-head"
    this.head.contentEditable = "false"
    this.contentDOM = document.createElement("div")
    this.contentDOM.className = "blk-body"
    this.foot = document.createElement("div")
    this.foot.className = "blk-foot"
    this.foot.contentEditable = "false"
    this.dom.append(this.head, this.contentDOM, this.foot)
    this.shown.set(this.dom, this)
    this.paint()
    noteTyping(() => ({ what: "line mounted", block: attrsOf(node).id }))
  }

  private paint(): void {
    const a = attrsOf(this.node)
    this.dom.dataset.kind = a.kind
    this.dom.dataset.block = a.id
    this.heads.set(this.head, a)
    this.feet.set(this.foot, a)
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.paint()
    return true
  }

  stopEvent(e: Event): boolean {
    return e.target instanceof globalThis.Node && (this.head.contains(e.target) || this.foot.contains(e.target))
  }

  ignoreMutation(m: MutationRecord | { type: "selection"; target: globalThis.Node }): boolean {
    return (m.type === "attributes" && m.target === this.dom) || this.head.contains(m.target) || this.foot.contains(m.target)
  }

  destroy(): void {
    noteTyping(() => ({ what: "line unmounted", block: attrsOf(this.node).id }))
    this.heads.drop(this.head)
    this.feet.drop(this.foot)
    this.shown.delete(this.dom)
  }
}

interface Drafts {
  posted: (block: string) => boolean
  inFeed: (block: string) => boolean
  made: Made
  version: number
}

function paintRuns(root: HTMLElement, shown: Map<HTMLElement, BlockView>, me: string, drafts: Drafts): void {
  let prev: Node | undefined
  const last = new Map<string, HTMLElement>()
  for (const el of root.children) {
    if (!(el instanceof HTMLElement)) continue
    const node = shown.get(el)?.node
    if (!node) continue
    const a = attrsOf(node)
    const empty = isEmpty(node)
    const mine = a.author === me
    const hidden = (empty && !mine) || drafts.posted(a.id) || drafts.inFeed(a.id)
    el.classList.toggle("is-cont", !hidden && continues(prev, node))
    el.classList.toggle("is-empty", empty)
    el.classList.toggle("is-mine", mine)
    el.classList.toggle("is-hidden", hidden)
    el.classList.toggle("is-draft", !hidden && isBack(node))
    if (a.kind === "text" && !empty) last.set(a.author, el)
    if (!hidden) prev = node
  }
  for (const el of last.values()) {
    const node = shown.get(el)?.node
    if (node && !isSent(node) && !drafts.posted(attrsOf(node).id)) el.classList.add("is-draft")
  }
}

function runsPlugin(shown: Map<HTMLElement, BlockView>, me: string, drafts: RefObject<Drafts>): Plugin {
  return new Plugin({
    view: (view) => {
      paintRuns(view.dom, shown, me, drafts.current)
      let painted = drafts.current.version
      return {
        update: (v, prev) => {
          if (v.state.doc === prev.doc && painted === drafts.current.version) return
          painted = drafts.current.version
          paintRuns(v.dom, shown, me, drafts.current)
        },
      }
    },
  })
}

function mentionView(name: (handle: string) => string): (node: Node) => NodeView {
  return (node) => {
    const dom = document.createElement("span")
    dom.className = "doc-mention"
    dom.dataset.mention = String(node.attrs.name)
    dom.textContent = `@${name(String(node.attrs.name))}`
    return { dom, ignoreMutation: () => true }
  }
}

function herePlugin(): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => {
        const here = blockAt(state)
        return here ? DecorationSet.create(state.doc, [Decoration.node(here.pos, here.pos + here.node.nodeSize, { class: "is-here" })]) : null
      },
    },
  })
}

function remote(tr: Transaction): boolean {
  const meta: unknown = tr.getMeta(ySyncPluginKey)
  return !!meta && typeof meta === "object" && "isChangeOrigin" in meta && !!meta.isChangeOrigin
}

function lineLength(doc: Node, id: string): number {
  let len = -1
  doc.forEach((n) => {
    if (attrsOf(n).id === id) len = n.textContent.length
  })
  return len
}

function storedLength(node: Y.XmlElement | Y.XmlText | Y.XmlHook): number {
  if (node instanceof Y.XmlText) return node.length
  if (!(node instanceof Y.XmlElement)) return 0
  return node.toArray().reduce((n, c) => n + storedLength(c), 0)
}

function textLength(node: Node): number {
  let n = 0
  node.descendants((c) => void (n += c.isText ? (c.text?.length ?? 0) : 0))
  return n
}

function focusOf(view: EditorView, doc: Y.Doc): TypingFocus | null {
  const here = blockAt(view.state)
  const id = here ? attrsOf(here.node).id : ""
  if (!here || !id) return null
  const el = doc
    .getXmlFragment(FRAGMENT)
    .toArray()
    .find((n) => n instanceof Y.XmlElement && n.getAttribute("id") === id)
  return { block: id, doc: docTag(doc), editor: textLength(here.node), stored: el ? storedLength(el) : -1 }
}

function noteEdit(before: EditorState, after: EditorState, tr: Transaction, doc: Y.Doc): void {
  const here = blockAt(before)
  const id = here ? attrsOf(here.node).id : ""
  const meta: unknown = tr.getMeta(ySyncPluginKey)
  const undo = !!meta && typeof meta === "object" && "isUndoRedoOperation" in meta && !!meta.isUndoRedoOperation
  noteTyping(() => ({
    what: remote(tr) ? "editor redrew from the doc" : "edit",
    origin: remote(tr) ? (undo ? "undo" : "doc") : "you",
    block: id,
    before: lineLength(before.doc, id),
    after: lineLength(after.doc, id),
    count: tr.steps.length,
    doc: docTag(doc),
  }))
}

function tidyPlugin(me: string, drafts: RefObject<Drafts>): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.selectionSet || tr.docChanged) || trs.some(remote)) return null
      const tidy = dropEmptyOwn(state, me, blockAt(state)?.index ?? null, drafts.current.made)
      if (tidy) noteTyping(() => ({ what: "tidy dropped empty lines", count: tidy.steps.length }))
      return tidy
    },
  })
}

function caretTop(view: EditorView): number | null {
  if (!view.hasFocus()) return null
  try {
    return view.coordsAtPos(view.state.selection.head).top
  } catch {
    // A caret in a node that isn't laid out (a hidden block, mid-render) has no coordinates: nothing to hold still.
    return null
  }
}

function steadyPlugin(scroller: () => HTMLElement | null, hold: (on: boolean) => void, me: string): Plugin {
  let before: number | null = null
  let view: EditorView | null = null
  const away = (v: EditorView): boolean => {
    if (!v.hasFocus()) return false
    const here = blockAt(v.state)
    const last = blocks(v.state.doc).findLast((b) => !isEmpty(b.node) || attrsOf(b.node).author === me)
    return !!here && !!last && here.index !== last.index
  }
  return new Plugin({
    filterTransaction: (tr) => {
      if (remote(tr) && view && before === null) before = caretTop(view)
      return true
    },
    view: (v) => {
      view = v
      return {
        update: (now) => {
          hold(away(now))
          if (before === null) return
          const after = caretTop(now)
          const box = scroller()
          if (box && after !== null && Math.abs(after - before) > 0.5) box.scrollTop += after - before
          before = null
        },
        destroy: () => {
          view = null
          hold(false)
        },
      }
    },
  })
}

function caretBuilder(seen: Map<number, { key: string; at: number }>) {
  return (user: { name: string; color: string }, clientId: number): HTMLElement => {
    const el = document.createElement("span")
    el.className = "doc-caret"
    el.style.setProperty("--member", `var(--c-${user.color})`)
    const tag = document.createElement("span")
    tag.className = "doc-caret-tag"
    tag.textContent = user.name
    const since = Date.now() - (seen.get(clientId)?.at ?? Date.now())
    tag.style.animationDelay = `${-Math.min(since, IDLE_MS)}ms`
    el.append(tag)
    return el
  }
}

function shareSelection(view: EditorView, shared: Shared, me: string): void {
  const { from, to } = view.state.selection
  const here = blockAt(view.state)
  const block = here ? attrsOf(here.node).id : null
  const text = from === to ? "" : view.state.doc.textBetween(from, to, "\n", "￼").slice(0, 2000)
  const was: unknown = shared.awareness.getLocalState()?.kiwi
  const next = { author: me, selection: block ? { block, text } : null }
  if (JSON.stringify(was) !== JSON.stringify(next)) shared.awareness.setLocalStateField("kiwi", next)
}

interface ViewOpts {
  editable: () => boolean
  name: (handle: string) => string
  onQuery: (q: Query | null, v: EditorView) => void
  onKey: (e: KeyboardEvent) => boolean
  scroller: () => HTMLElement | null
  hold: (on: boolean) => void
  drafts: RefObject<Drafts>
  media: () => DocMedia | null
  command: CommandFor
  refuse: (line: string) => boolean
  editLast: () => boolean
}

const openImage = (url: string) => void window.open(url, "_blank", "noopener,noreferrer")

function takeFiles(view: EditorView, doc: Y.Doc, me: string, media: DocMedia | null, editable: boolean, files: readonly File[], made: Made): boolean {
  if (!files.length || !media || !editable) return false
  const target = uploadTarget(view.state, me, Date.now(), made)
  if (target.tr) view.dispatch(target.tr)
  const done = startUpload(target.id)
  void uploadAll(files, media, (why) => announce(why, "error"))
    .then((nodes) => {
      if (view.isDestroyed) return void attachToDoc(doc, me, target.id, nodes)
      const tr = attachTo(view.state, me, target.id, nodes) ?? attach(view.state, me, Date.now(), nodes, made)
      if (tr) view.dispatch(tr)
    })
    .finally(done)
  return true
}

function makeView(mount: HTMLElement, shared: Shared, me: string, heads: Heads, feet: Heads, opts: ViewOpts): { view: EditorView; stop: () => void } {
  const seen = new Map<number, { key: string; at: number }>()
  const shown = new Map<HTMLElement, BlockView>()
  const watch = ({ added, updated }: { added: number[]; updated: number[] }) => {
    const states = shared.awareness.getStates()
    for (const id of [...added, ...updated]) {
      const key = JSON.stringify(states.get(id)?.cursor ?? null)
      if (seen.get(id)?.key !== key) seen.set(id, { key, at: Date.now() })
    }
  }
  shared.awareness.on("change", watch)
  const blur = { now: () => {} }
  const state = EditorState.create({
    schema,
    plugins: [
      ySyncPlugin(shared.doc.getXmlFragment(FRAGMENT)),
      yCursorPlugin(shared.awareness, {
        awarenessStateFilter: caretShown(me),
        cursorBuilder: caretBuilder(seen),
        selectionBuilder: (u: { color: string }) => ({ class: "doc-sel", style: `--member: var(--c-${u.color})` }),
      }),
      yUndoPlugin(),
      suggestPlugin(opts.onQuery, opts.onKey),
      markdownRules(),
      ...docKeys(
        me,
        () => Date.now(),
        () => blur.now(),
        {
          posted: (block) => opts.drafts.current.posted(block),
          made: (block) => opts.drafts.current.made(block),
          commandFor: opts.command,
          refuse: opts.refuse,
          editLast: opts.editLast,
          sending: (block) => shared.made.add(block),
        }
      ),
      linksPlugin(),
      herePlugin(),
      runsPlugin(shown, me, opts.drafts),
      tidyPlugin(me, opts.drafts),
      steadyPlugin(opts.scroller, opts.hold, me),
    ],
  })
  const own = writeOwnLinesOnly(state, () => (view.isDestroyed ? null : view))
  const view: EditorView = new EditorView(mount, {
    state,
    editable: opts.editable,
    attributes: { class: "doc", role: "textbox", "aria-multiline": "true", "aria-label": "Thread" },
    nodeViews: {
      block: (node) => new BlockView(node, heads, feet, shown),
      mention: mentionView(opts.name),
      image: imageView(opts.media, openImage),
      file: fileView(opts.media),
    },
    handlePaste: (v, e) => {
      const dt = e.clipboardData
      if (takeFiles(v, shared.doc, me, opts.media(), opts.editable(), filesIn(dt), opts.drafts.current.made)) {
        e.preventDefault()
        return true
      }
      if (!dt || !emptyPaste(dt) || !opts.media() || !opts.editable()) return false
      e.preventDefault()
      void takePasted(dt).then((f) => f && takeFiles(v, shared.doc, me, opts.media(), opts.editable(), [f], opts.drafts.current.made))
      return true
    },
    handleDrop: (v, e) => {
      const dt = e.dataTransfer
      if (takeFiles(v, shared.doc, me, opts.media(), opts.editable(), filesIn(dt), opts.drafts.current.made)) {
        e.preventDefault()
        return true
      }
      if (!dt || !fileDrag(dt) || !opts.media() || !opts.editable()) return false
      e.preventDefault()
      void takeDropped(dt).then(({ files, refused }) => {
        for (const why of refused) announce(why, "error")
        takeFiles(v, shared.doc, me, opts.media(), opts.editable(), files, opts.drafts.current.made)
      })
      return true
    },
    dispatchTransaction(this: EditorView, sent) {
      if (this.isDestroyed) return
      const tr = withScreenSelection(this, sent)
      const before = this.state
      const next = this.state.apply(tr)
      if (tr.docChanged && !remote(tr)) {
        noteMade(before.doc, next.doc, me, shared.made)
        own?.touched(before.doc, next.doc)
      }
      this.updateState(next)
      if (tr.docChanged && tracingTyping()) noteEdit(before, this.state, tr, shared.doc)
      if (tr.selectionSet || tr.docChanged) shareSelection(this, shared, me)
    },
  })
  blur.now = () => view.dom.blur()
  const unkeep = keepScreenSelection(view)
  return {
    view,
    stop: () => {
      unkeep()
      own?.stop()
      shared.awareness.off("change", watch)
    },
  }
}

function ReplyLine({ channel, to, quote, onClose }: { channel: Channel; to: Message | undefined; quote: string | null; onClose: (() => void) | null }) {
  const line = quote ? quote.replace(/\s+/g, " ") : to ? withNames(to.text, channel.nicknames, preview) : ""
  return (
    <div className={cx("compose-reply", "blk-re", quote && "is-excerpt")}>
      <Icon name="reply" size={13} />
      <span className="compose-reply-text">
        {quote ? "Quoting" : "Replying to"} {to && <b>{nickname(channel, to.from)}</b>}{" "}
        <span className={quote ? "compose-reply-excerpt" : "dim"}>{quote ? `“${line.slice(0, 160)}${line.length > 160 ? "…" : ""}”` : line.slice(0, 160)}</span>
      </span>
      {onClose && (
        <button type="button" className="compose-reply-x" aria-label="Cancel reply" title="Cancel reply (Esc)" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  )
}

function Head({ channel, attrs, onUnreply }: { channel: Channel; attrs: BlockAttrs; onUnreply: (id: string) => void }) {
  const { go } = useApp()
  if (!attrs.author) return null
  return (
    <>
      {attrs.re !== null && (
        <ReplyLine channel={channel} to={channel.messages.find((m) => m.seq === attrs.re)} quote={attrs.quote} onClose={attrs.author === channel.you ? () => onUnreply(attrs.id) : null} />
      )}
      <span className="blk-line">
        <button type="button" className="msg-name" title={clock(attrs.at)} onClick={() => go({ to: "modal", modal: { kind: "person", name: attrs.author } })}>
          {nickname(channel, attrs.author)}
        </button>
        {(attrs.kind === "tool" || attrs.kind === "comment") && <span className="blk-kind">{attrs.kind}</span>}
      </span>
    </>
  )
}

type Option = { kind: "@"; person: Person } | { kind: "#"; task: Task } | { kind: "/"; command: Command }

function optionsFor(channel: Channel, commands: readonly Command[], q: Query | null): Option[] {
  if (!q) return []
  if (q.kind === "/") return matchCommands(commands, `/${q.text}`).map((command) => ({ kind: "/", command }))
  return q.kind === "@" ? peopleMatches(channel.people, q.text).map((person) => ({ kind: "@", person })) : taskMatches(channel.tasks, q.text).map((task) => ({ kind: "#", task }))
}

function choose(view: EditorView, q: Query, o: Option): void {
  const tr = view.state.tr
  if (o.kind === "/") tr.insertText(`/${o.command.name} `, q.from, q.to)
  else if (o.kind === "@") tr.replaceWith(q.from, q.to, [schema.nodes.mention.create({ name: o.person.name }), schema.text(" ")])
  else tr.insertText(`T${o.task.id} `, q.from, q.to)
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

function Suggest({ channel, query, options, pick, at, onPick }: { channel: Channel; query: Query; options: Option[]; pick: number; at: { left: number; top: number }; onPick: (i: number) => void }) {
  if (options.length === 0) return null
  return (
    <ul className="mentions doc-suggest" role="listbox" aria-label={query.kind === "@" ? "People" : query.kind === "/" ? "Commands" : "Tasks"} style={{ left: at.left, top: at.top }}>
      {options.map((o, i) => (
        <li key={o.kind === "@" ? o.person.name : o.kind === "/" ? o.command.name : o.task.id} role="option" aria-selected={i === pick}>
          {o.kind === "/" ? (
            <button type="button" tabIndex={-1} className={cx("mention-row task-row", i === pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(i)}>
              <span className="command-name">/{o.command.name}</span>
              {o.command.args && <span className="task-row-id">{o.command.args}</span>}
              <span className="task-row-title dim">{o.command.summary}</span>
            </button>
          ) : o.kind === "@" ? (
            <button type="button" tabIndex={-1} className={cx("mention-row", i === pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(i)}>
              <Avatar person={o.person} size="sm" pip />
              <span className="mention-name">{nickname(channel, o.person.name)}</span>
              {nickname(channel, o.person.name) !== o.person.name && <span className="dim">@{o.person.name}</span>}
            </button>
          ) : (
            <button type="button" tabIndex={-1} className={cx("mention-row task-row", i === pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(i)}>
              <Dot status={o.task.status} />
              <span className="task-row-id">T{o.task.id}</span>
              <span className="task-row-title">{o.task.title}</span>
              <span className="dim">{o.task.owner ? nickname(channel, o.task.owner) : STATUS_WORDS[o.task.status]}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function typedAnywhere(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || [...e.key].length !== 1) return false
  const t = e.target
  if (!(t instanceof HTMLElement)) return true
  return !t.closest("input, textarea, select, [contenteditable='true'], dialog, [role='dialog'], [role='menu'], .ProseMirror")
}

const within = (r: DOMRect, x: number, y: number): boolean => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

export function ThreadDoc({
  channel,
  where,
  thread,
  shared,
  hold,
  media = null,
}: {
  channel: Channel
  where: Where
  thread: string
  shared: Shared
  hold: (on: boolean) => void
  media?: DocMedia | null
}) {
  const mount = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [heads] = useState(() => new Heads())
  const list = useSyncExternalStore(heads.subscribe, heads.snapshot)
  const [feet] = useState(() => new Heads())
  const footList = useSyncExternalStore(feet.subscribe, feet.snapshot)
  const asked = useMemo(() => {
    const out = new Map<string, QuestionAsk>()
    for (const m of channel.messages) {
      const ask = m.block && m.ask ? channel.asks.find((a) => a.id === m.ask) : undefined
      if (m.block && ask?.kind === "question") out.set(m.block, ask)
    }
    return out
  }, [channel.messages, channel.asks])
  const me = channel.you
  const you = channel.people.find((p) => p.you)
  const { app } = useApp()
  const tooOld = useSyncExternalStore(
    (on) => onWriterFloor(shared.doc, on),
    () => writerFloor(shared.doc) > DOC_LEVEL
  )
  const readOnly = !!you?.readOnly || tooOld
  const canWrite = useRef(!readOnly)
  const latest = useRef(channel)
  const holdRef = useRef(hold)
  const drafts = useRef<Drafts>({ posted: () => false, inFeed: () => false, made: (block) => shared.made.has(block), version: 0 })
  const sent = useMemo(() => postedBlocks(channel.messages), [channel.messages])
  const feedKey = `${channel.code}\n${thread}`
  const since = useMemo(() => oldestAt(channel.messages), [channel.messages])

  useLayoutEffect(() => {
    const publish = () => {
      const feed = docFeed(blocksOf(shared.doc), richBlocks(shared.doc), sent, since)
      setDocFeed(feedKey, feed)
      drafts.current = {
        posted: (block) => sent.has(block) && !feed.media.has(block),
        inFeed: (block) => feed.hidden.has(block),
        made: (block) => shared.made.has(block),
        version: drafts.current.version + 1,
      }
      view.current?.setProps({})
    }
    publish()
    shared.doc.on("update", publish)
    return () => shared.doc.off("update", publish)
  }, [sent, since, shared, feedKey])
  const mediaRef = useRef(media)
  const [query, setQuery] = useState<{ q: Query; left: number; top: number } | null>(null)
  const [pick, setPick] = useState(0)
  const [dropping, setDropping] = useState(false)
  const commands = useCommands(channel)
  const commandsRef = useRef(commands)
  const whereRef = useRef(where)
  const options = optionsFor(channel, commands, query?.q ?? null)
  const keys = useRef<(e: KeyboardEvent) => boolean>(() => false)
  const replying = useReplying()

  const dropReply = (id: string) => {
    const v = view.current
    const tr = v ? unreply(v.state, id) : null
    if (v && tr) v.dispatch(tr)
  }

  useLayoutEffect(() => {
    const changed = canWrite.current !== !readOnly
    canWrite.current = !readOnly
    latest.current = channel
    holdRef.current = hold
    mediaRef.current = media
    commandsRef.current = commands
    whereRef.current = where
    if (changed) view.current?.setProps({})
  })

  useLayoutEffect(() => {
    keys.current = (e) => {
      const v = view.current
      if (!v || !query || options.length === 0) return false
      const does = menuKey(e)
      if (does === "move") {
        setPick((p) => (p + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length)
        return true
      }
      if (does === "choose") {
        const o = options[Math.min(pick, options.length - 1)]
        if (e.key === "Enter" && o?.kind === "/" && o.command.name === query.q.text) return false
        if (o) choose(v, query.q, o)
        return true
      }
      if (does === "close") {
        dismiss(v)
        return true
      }
      return false
    }
  })

  useLayoutEffect(() => {
    const el = mount.current
    if (!el) return
    const built = makeView(el, shared, me, heads, feet, {
      editable: () => canWrite.current,
      name: (handle) => nickname(latest.current, handle),
      onQuery: (q, v) => {
        setPick(0)
        if (!q) return setQuery(null)
        const host = box.current?.getBoundingClientRect()
        const at = v.coordsAtPos(q.from)
        setQuery({ q, left: at.left - (host?.left ?? 0), top: at.bottom - (host?.top ?? 0) + 4 })
      },
      onKey: (e) => keys.current(e),
      scroller: () => box.current?.closest<HTMLElement>(".feed") ?? null,
      hold: (on) => holdRef.current(on),
      drafts,
      media: () => mediaRef.current,
      refuse: (line) => {
        const why = tooLong(line)
        if (why) announce(why, "error")
        return !!why
      },
      editLast: () => {
        const c = latest.current
        const last = c.messages.findLast((m) => m.canChange && m.inThread === undefined && sameWhere(m.where, whereRef.current))
        if (!last) return false
        startEditing(c.code, last.seq)
        return true
      },
      command: (line) => {
        const found = parseCommand(commandsRef.current, line)
        return found ? () => found.command.run(found.args) : null
      },
    })
    const v = built.view
    view.current = v
    noteTyping(() => ({ what: "editor mounted" }))
    const unfocus = setTypingFocus(() => focusOf(v, shared.doc))
    if (canWrite.current && !document.activeElement?.closest("input, textarea, [contenteditable='true']")) {
      v.dispatch(startBlock(v.state, me, Date.now(), drafts.current.posted, drafts.current.made))
      v.focus()
    }
    return () => {
      const tidy = dropEmptyOwn(v.state, me, null, drafts.current.made)
      noteTyping(() => ({ what: "editor unmounted", count: tidy?.steps.length ?? 0 }))
      if (tidy) v.dispatch(tidy)
      unfocus()
      built.stop()
      v.destroy()
      view.current = null
    }
  }, [shared, me, heads, feet])

  useEffect(() => {
    const v = view.current
    const to = replying?.to
    if (!v || !replying || !to) return
    replying.set(null)
    if (!canWrite.current) return
    v.dispatch(replyIn(v.state, me, Date.now(), to.seq, replying.excerpt, drafts.current.posted, drafts.current.made))
    v.focus()
    const at = v.domAtPos(v.state.selection.head).node
    const el = at instanceof HTMLElement ? at : at.parentElement
    requestAnimationFrame(() => el?.closest(".blk")?.scrollIntoView({ block: "nearest" }))
  }, [replying, me])

  useEffect(
    () =>
      onGiveBack((id) => {
        const v = view.current
        const tr = v && canWrite.current ? backInDraft(v.state, me, id, drafts.current.made) : null
        if (!v || !tr) return
        noteTyping(() => ({ what: "back to draft", block: id }))
        v.dispatch(tr.scrollIntoView())
        const here = blockAt(v.state)
        if (here && attrsOf(here.node).id === id) v.focus()
      }),
    [me]
  )

  useEffect(() => {
    shared.awareness.setLocalStateField("user", { name: nickname(channel, me), color: you?.color ?? "blue" })
  }, [shared, channel, me, you?.color])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = view.current
      if (!v || !canWrite.current || !typedAnywhere(e) || document.querySelector("dialog[open]")) return
      v.dispatch(startBlock(v.state, me, Date.now(), drafts.current.posted, drafts.current.made).scrollIntoView())
      v.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [me])

  useEffect(() => {
    let off: ReturnType<typeof setTimeout> | null = null
    const onDrag = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt || !fileDrag(dt)) return
      const taken = e.defaultPrevented
      e.preventDefault()
      const v = view.current
      const el = box.current
      const over = !!el && within(el.getBoundingClientRect(), e.clientX, e.clientY)
      if (off) clearTimeout(off)
      setDropping(e.type !== "drop" && over && canWrite.current && !!mediaRef.current)
      off = setTimeout(() => setDropping(false), 250)
      if (e.type !== "drop" || taken || !v || !el || !over) return
      const files = filesIn(dt)
      if (takeFiles(v, shared.doc, me, mediaRef.current, canWrite.current, files, drafts.current.made) || files.length) return
      void takeDropped(dt).then(({ files: dropped, refused }) => {
        for (const why of refused) announce(why, "error")
        takeFiles(v, shared.doc, me, mediaRef.current, canWrite.current, dropped, drafts.current.made)
      })
    }
    window.addEventListener("dragover", onDrag)
    window.addEventListener("drop", onDrag)
    return () => {
      if (off) clearTimeout(off)
      window.removeEventListener("dragover", onDrag)
      window.removeEventListener("drop", onDrag)
    }
  }, [me, shared])

  const place =
    where.kind === "room"
      ? `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}`
      : where.kind === "task"
        ? `T${where.task}`
        : where.kind === "dm"
          ? nickname(channel, where.with)
          : ""
  const prompt = where.kind === "dm" ? `Write to ${place}` : `Write in ${place}`

  const write = () => {
    const v = view.current
    if (!v || !canWrite.current) return
    v.dispatch(startBlock(v.state, me, Date.now(), drafts.current.posted, drafts.current.made).scrollIntoView())
    v.focus()
  }

  return (
    <div ref={box} className={cx("thread-doc", readOnly && "is-read-only")} style={{ "--place": JSON.stringify(`${prompt} · ${SEND_KEYS} sends`) } as CSSProperties}>
      {tooOld && (
        <p className="doc-old">
          A newer Channels writes here. You can read; typing comes back with the new look.
          {app.account?.uiUpdate && (
            <button type="button" onClick={() => app.actions.applyUi()}>
              Switch
            </button>
          )}
        </p>
      )}
      <div ref={mount} />
      {dropping && (
        <div className="doc-drop" aria-hidden="true">
          <span>Drop to add it here</span>
        </div>
      )}
      {!readOnly && <button type="button" className="doc-tail" aria-label={prompt} onMouseDown={(e) => e.preventDefault()} onClick={write} />}
      {query && (
        <Suggest
          channel={channel}
          query={query.q}
          options={options}
          pick={Math.min(pick, Math.max(0, options.length - 1))}
          at={query}
          onPick={(i) => {
            const o = options[i]
            if (o && view.current) choose(view.current, query.q, o)
          }}
        />
      )}
      {list.map(([el, key, attrs]) => createPortal(<Head channel={channel} attrs={attrs} onUnreply={dropReply} />, el, String(key)))}
      {footList.flatMap(([el, key, attrs]) => {
        const ask = asked.get(attrs.id)
        return ask
          ? [
              createPortal(
                <Suspense fallback={null}>
                  <QuestionCard channel={channel} ask={ask} />
                </Suspense>,
                el,
                `ask-${key}`
              ),
            ]
          : []
      })}
    </div>
  )
}

export function LiveThreadDoc({ channel, where, thread, hold }: { channel: Channel; where: Where; thread: string; hold: (on: boolean) => void }) {
  const { actions } = useAct()
  const th = channel.docs?.[thread]
  const first = useRef(th)
  const [live, setLive] = useState<LiveDoc | null>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const code = channel.code
  const media = useMemo<DocMedia>(
    () => ({
      putImage: (u) => actions.putDocImage(code, u),
      putFile: (u) => actions.putDocFile(code, u),
      image: (img) => actions.docImage(code, img),
      file: (f) => actions.docFile(code, f),
    }),
    [actions, code]
  )
  const me = channel.you
  const here = useRef(where)
  const sent = useMemo(() => postedBlocks(channel.messages), [channel.messages])
  const known = useRef(sent)

  useEffect(() => {
    here.current = where
    known.current = sent
  })

  useEffect(() => {
    const held = holdDoc(
      `${code}\n${thread}`,
      () =>
        new LiveDoc(
          (at, on) => actions.openDoc(code, thread, at, on),
          first.current,
          (why) => announce(`The shared doc didn't open: ${why}`, "error"),
          {
            me,
            post: (text, block, reply) => actions.send(code, here.current, reply?.quote ? withExcerpt(reply.quote, text) : text, { block, ...(reply ? { replyTo: reply.re } : {}) }),
            posted: (block) => known.current.has(block),
          }
        )
    )
    setLive(held.live)
    const off = held.live.whenReady(bump)
    return () => {
      off()
      setLive(null)
      held.release()
    }
  }, [actions, code, thread, me])

  useEffect(() => live?.want(th), [live, th])

  return live?.isReady ? <ThreadDoc channel={channel} where={where} thread={thread} shared={live} hold={hold} media={media} /> : null
}
