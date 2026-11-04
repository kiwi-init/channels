import "~/styles/thread-doc.css"

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react"
import { createPortal } from "react-dom"
import type { Node } from "prosemirror-model"
import { EditorState, Plugin, type Transaction } from "prosemirror-state"
import { Decoration, DecorationSet, EditorView, type NodeView } from "prosemirror-view"
import { yCursorPlugin, ySyncPlugin, ySyncPluginKey, yUndoPlugin } from "y-prosemirror"

import { attach, blockAt, blocks, continues, dropEmptyOwn, isEmpty, startBlock } from "~/chat/doc/blocks"
import { docKeys } from "~/chat/doc/keys"
import { holdDoc, LiveDoc, type Shared } from "~/chat/doc/live"
import { linksPlugin } from "~/chat/doc/links"
import { fileDrag, takeDropped } from "@kiwi/app/dropped.ts"
import { emptyPaste, takePasted } from "@kiwi/app/pasted.ts"
import { fileView, filesIn, imageView, uploadAll, type DocMedia } from "~/chat/doc/media"
import { postedBlocks } from "~/chat/doc/posted"
import { markdownRules } from "~/chat/doc/rules"
import { attrsOf, FRAGMENT, isSent, schema, type BlockAttrs } from "~/chat/doc/schema"
import { dismiss, suggestPlugin, type Query } from "~/chat/doc/suggest"
import { peopleMatches, taskMatches } from "~/chat/matches"
import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { clock } from "~/kit/time"
import { announce } from "~/kit/toasts"
import { refusal } from "~/live/refused"
import type { Channel, Person, QuestionAsk, Task, Where } from "~/model"
import { nickname } from "~/names"
import { useAct, useApp } from "~/nav"

const QuestionCard = lazy(() => import("~/chat/question-card"))

const IDLE_MS = 4000

type HeadList = readonly (readonly [HTMLElement, number, BlockAttrs])[]

class Heads {
  private all = new Map<HTMLElement, { key: number; attrs: BlockAttrs }>()
  private list: HeadList = []
  private heard = new Set<() => void>()
  private next = 0
  private queued = false

  set(el: HTMLElement, attrs: BlockAttrs): void {
    const was = this.all.get(el)
    if (was && was.attrs.id === attrs.id && was.attrs.author === attrs.author && was.attrs.kind === attrs.kind && was.attrs.at === attrs.at) return
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
    this.heads.drop(this.head)
    this.feet.drop(this.foot)
    this.shown.delete(this.dom)
  }
}

interface Drafts {
  posted: (block: string) => boolean
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
    const hidden = (empty && !mine) || drafts.posted(a.id)
    el.classList.toggle("is-cont", !hidden && continues(prev, node))
    el.classList.toggle("is-empty", empty)
    el.classList.toggle("is-mine", mine)
    el.classList.toggle("is-hidden", hidden)
    el.classList.remove("is-draft")
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

function tidyPlugin(me: string): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.selectionSet || tr.docChanged) || trs.some(remote)) return null
      return dropEmptyOwn(state, me, blockAt(state)?.index ?? null)
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
}

const openImage = (url: string) => void window.open(url, "_blank", "noopener,noreferrer")

function takeFiles(view: EditorView, me: string, media: DocMedia | null, editable: boolean, files: readonly File[]): boolean {
  if (!files.length || !media || !editable) return false
  void uploadAll(files, media, (why) => announce(why, "error")).then((nodes) => {
    if (view.isDestroyed) return
    const tr = attach(view.state, me, Date.now(), nodes)
    if (tr) view.dispatch(tr)
  })
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
      yCursorPlugin(shared.awareness, { cursorBuilder: caretBuilder(seen), selectionBuilder: (u: { color: string }) => ({ class: "doc-sel", style: `--member: var(--c-${u.color})` }) }),
      yUndoPlugin(),
      suggestPlugin(opts.onQuery, opts.onKey),
      markdownRules(),
      ...docKeys(
        me,
        () => Date.now(),
        () => blur.now(),
        (block) => opts.drafts.current.posted(block)
      ),
      linksPlugin(),
      herePlugin(),
      runsPlugin(shown, me, opts.drafts),
      tidyPlugin(me),
      steadyPlugin(opts.scroller, opts.hold, me),
    ],
  })
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
      if (takeFiles(v, me, opts.media(), opts.editable(), filesIn(dt))) {
        e.preventDefault()
        return true
      }
      if (!dt || !emptyPaste(dt) || !opts.media() || !opts.editable()) return false
      e.preventDefault()
      void takePasted(dt).then((f) => f && takeFiles(v, me, opts.media(), opts.editable(), [f]))
      return true
    },
    handleDrop: (v, e) => {
      const dt = e.dataTransfer
      if (takeFiles(v, me, opts.media(), opts.editable(), filesIn(dt))) {
        e.preventDefault()
        return true
      }
      if (!dt || !fileDrag(dt) || !opts.media() || !opts.editable()) return false
      e.preventDefault()
      void takeDropped(dt).then(({ files, refused }) => {
        for (const why of refused) announce(why, "error")
        takeFiles(v, me, opts.media(), opts.editable(), files)
      })
      return true
    },
    dispatchTransaction(this: EditorView, tr) {
      if (this.isDestroyed) return
      this.updateState(this.state.apply(tr))
      if (tr.selectionSet || tr.docChanged) shareSelection(this, shared, me)
    },
  })
  blur.now = () => view.dom.blur()
  return { view, stop: () => shared.awareness.off("change", watch) }
}

function Head({ channel, attrs }: { channel: Channel; attrs: BlockAttrs }) {
  const { go } = useApp()
  if (!attrs.author) return null
  return (
    <>
      <span className="blk-line">
        <button type="button" className="msg-name" title={clock(attrs.at)} onClick={() => go({ to: "modal", modal: { kind: "person", name: attrs.author } })}>
          {nickname(channel, attrs.author)}
        </button>
        {(attrs.kind === "tool" || attrs.kind === "comment") && <span className="blk-kind">{attrs.kind}</span>}
      </span>
    </>
  )
}

type Option = { kind: "@"; person: Person } | { kind: "#"; task: Task }

function optionsFor(channel: Channel, q: Query | null): Option[] {
  if (!q) return []
  return q.kind === "@" ? peopleMatches(channel.people, q.text).map((person) => ({ kind: "@", person })) : taskMatches(channel.tasks, q.text).map((task) => ({ kind: "#", task }))
}

function choose(view: EditorView, q: Query, o: Option): void {
  const tr = view.state.tr
  if (o.kind === "@") tr.replaceWith(q.from, q.to, [schema.nodes.mention.create({ name: o.person.name }), schema.text(" ")])
  else tr.insertText(`T${o.task.id} `, q.from, q.to)
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

function Suggest({ channel, query, options, pick, at, onPick }: { channel: Channel; query: Query; options: Option[]; pick: number; at: { left: number; top: number }; onPick: (i: number) => void }) {
  if (options.length === 0) return null
  return (
    <ul className="mentions doc-suggest" role="listbox" aria-label={query.kind === "@" ? "People" : "Tasks"} style={{ left: at.left, top: at.top }}>
      {options.map((o, i) => (
        <li key={o.kind === "@" ? o.person.name : o.task.id} role="option" aria-selected={i === pick}>
          {o.kind === "@" ? (
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

export function ThreadDoc({ channel, where, shared, hold, media = null }: { channel: Channel; where: Where; shared: Shared; hold: (on: boolean) => void; media?: DocMedia | null }) {
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
  const readOnly = !!you?.readOnly
  const canWrite = useRef(!readOnly)
  const latest = useRef(channel)
  const holdRef = useRef(hold)
  const drafts = useRef<Drafts>({ posted: () => false, version: 0 })
  const sent = useMemo(() => postedBlocks(channel.messages), [channel.messages])

  useLayoutEffect(() => {
    drafts.current = { posted: (block) => sent.has(block), version: drafts.current.version + 1 }
    view.current?.setProps({})
  }, [sent])
  const mediaRef = useRef(media)
  const [query, setQuery] = useState<{ q: Query; left: number; top: number } | null>(null)
  const [pick, setPick] = useState(0)
  const options = optionsFor(channel, query?.q ?? null)
  const keys = useRef<(e: KeyboardEvent) => boolean>(() => false)

  useLayoutEffect(() => {
    const changed = canWrite.current !== !readOnly
    canWrite.current = !readOnly
    latest.current = channel
    holdRef.current = hold
    mediaRef.current = media
    if (changed) view.current?.setProps({})
  })

  useLayoutEffect(() => {
    keys.current = (e) => {
      const v = view.current
      if (!v || !query || options.length === 0) return false
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setPick((p) => (p + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length)
        return true
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const o = options[Math.min(pick, options.length - 1)]
        if (o) choose(v, query.q, o)
        return true
      }
      if (e.key === "Escape") {
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
    })
    const v = built.view
    view.current = v
    if (canWrite.current && !document.activeElement?.closest("input, textarea, [contenteditable='true']")) {
      v.dispatch(startBlock(v.state, me, Date.now()))
      v.focus()
    }
    return () => {
      const tidy = dropEmptyOwn(v.state, me, null)
      if (tidy) v.dispatch(tidy)
      built.stop()
      v.destroy()
      view.current = null
    }
  }, [shared, me, heads, feet])

  useEffect(() => {
    shared.awareness.setLocalStateField("user", { name: nickname(channel, me), color: you?.color ?? "blue" })
  }, [shared, channel, me, you?.color])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = view.current
      if (!v || !canWrite.current || !typedAnywhere(e) || document.querySelector("dialog[open]")) return
      v.dispatch(startBlock(v.state, me, Date.now()).scrollIntoView())
      v.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [me])

  useEffect(() => {
    const onDrag = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (!dt || !fileDrag(dt)) return
      const taken = e.defaultPrevented
      e.preventDefault()
      const v = view.current
      const el = box.current
      if (e.type !== "drop" || taken || !v || !el || !within(el.getBoundingClientRect(), e.clientX, e.clientY)) return
      const files = filesIn(dt)
      if (takeFiles(v, me, mediaRef.current, canWrite.current, files) || files.length) return
      void takeDropped(dt).then(({ files: dropped, refused }) => {
        for (const why of refused) announce(why, "error")
        takeFiles(v, me, mediaRef.current, canWrite.current, dropped)
      })
    }
    window.addEventListener("dragover", onDrag)
    window.addEventListener("drop", onDrag)
    return () => {
      window.removeEventListener("dragover", onDrag)
      window.removeEventListener("drop", onDrag)
    }
  }, [me])

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
    v.dispatch(startBlock(v.state, me, Date.now()).scrollIntoView())
    v.focus()
  }

  return (
    <div ref={box} className={cx("thread-doc", readOnly && "is-read-only")} style={{ "--place": JSON.stringify(prompt) } as CSSProperties}>
      <div ref={mount} />
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
      {list.map(([el, key, attrs]) => createPortal(<Head channel={channel} attrs={attrs} />, el, String(key)))}
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

  useEffect(() => {
    here.current = where
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
            post: (text, block) =>
              actions.send(code, here.current, text, { block }).then(
                () => true,
                (e: unknown) => refusal(e) === null
              ),
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

  return live?.isReady ? <ThreadDoc channel={channel} where={where} shared={live} hold={hold} media={media} /> : null
}
