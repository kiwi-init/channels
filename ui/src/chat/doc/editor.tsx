import "~/styles/thread-doc.css"

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { baseKeymap, splitBlock, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import type { Node } from "prosemirror-model"
import { EditorState, Plugin, PluginKey } from "prosemirror-state"
import { Decoration, DecorationSet, EditorView, type NodeView } from "prosemirror-view"
import { redo, undo, yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror"

import { blockAfter, blockAt, blocks, continues, dropEmptyOwn, finishesBlock, isEmpty, startBlock } from "~/chat/doc/blocks"
import { localDoc, type Shared } from "~/chat/doc/local"
import { attrsOf, FRAGMENT, schema, type BlockAttrs } from "~/chat/doc/schema"
import { Avatar, cx } from "~/kit/bits"
import { clock } from "~/kit/time"
import type { Channel, Where } from "~/model"
import { nickname } from "~/names"
import { useApp } from "~/nav"

class Heads {
  private all = new Map<HTMLElement, { key: number; attrs: BlockAttrs }>()
  private list: readonly (readonly [HTMLElement, number, BlockAttrs])[] = []
  private heard = new Set<() => void>()
  private next = 0

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

  snapshot = (): readonly (readonly [HTMLElement, number, BlockAttrs])[] => this.list

  private changed(): void {
    this.list = [...this.all].map(([el, v]) => [el, v.key, v.attrs] as const)
    for (const f of this.heard) f()
  }
}

class BlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private head: HTMLElement

  constructor(
    private node: Node,
    private heads: Heads
  ) {
    this.dom = document.createElement("section")
    this.dom.className = "blk"
    this.head = document.createElement("div")
    this.head.className = "blk-head"
    this.head.contentEditable = "false"
    this.contentDOM = document.createElement("div")
    this.contentDOM.className = "blk-body"
    this.dom.append(this.head, this.contentDOM)
    this.paint()
  }

  private paint(): void {
    const a = attrsOf(this.node)
    this.dom.dataset.kind = a.kind
    this.dom.dataset.block = a.id
    this.heads.set(this.head, a)
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.paint()
    return true
  }

  stopEvent(e: Event): boolean {
    return e.target instanceof globalThis.Node && this.head.contains(e.target)
  }

  ignoreMutation(m: MutationRecord | { type: "selection"; target: globalThis.Node }): boolean {
    return this.head.contains(m.target)
  }

  destroy(): void {
    this.heads.drop(this.head)
  }
}

const looks = new PluginKey("thread-doc-looks")

function looksPlugin(me: string): Plugin {
  return new Plugin({
    key: looks,
    props: {
      decorations(state) {
        const here = blockAt(state)
        const decos: Decoration[] = []
        let prev: Node | undefined
        for (const b of blocks(state.doc)) {
          const a = attrsOf(b.node)
          const empty = isEmpty(b.node)
          const mine = a.author === me
          const hidden = empty && !mine
          decos.push(
            Decoration.node(b.pos, b.pos + b.node.nodeSize, {
              class: cx("blk", !hidden && continues(prev, b.node) && "is-cont", empty && "is-empty", mine && "is-mine", hidden && "is-hidden", here?.index === b.index && "is-here"),
            })
          )
          if (!hidden) prev = b.node
        }
        return DecorationSet.create(state.doc, decos)
      },
    },
  })
}

function tidyPlugin(me: string): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null
      if (trs.some((tr) => tr.getMeta("addToHistory") === false && !tr.selectionSet)) return null
      return dropEmptyOwn(state, me, blockAt(state)?.index ?? null)
    },
  })
}

function caret(user: { name: string; color: string }): HTMLElement {
  const el = document.createElement("span")
  el.className = "doc-caret"
  el.style.setProperty("--member", `var(--c-${user.color})`)
  const tag = document.createElement("span")
  tag.className = "doc-caret-tag"
  tag.textContent = user.name
  el.append(tag)
  return el
}

function makeView(mount: HTMLElement, shared: Shared, me: string, heads: Heads, editable: () => boolean): EditorView {
  const now = () => Date.now()
  const state = EditorState.create({
    schema,
    plugins: [
      ySyncPlugin(shared.doc.getXmlFragment(FRAGMENT)),
      yCursorPlugin(shared.awareness, { cursorBuilder: caret, selectionBuilder: (u: { color: string }) => ({ class: "doc-sel", style: `--member: var(--c-${u.color})` }) }),
      yUndoPlugin(),
      keymap({
        "Mod-z": undo,
        "Mod-y": redo,
        "Mod-Shift-z": redo,
        "Mod-e": toggleMark(schema.marks.code),
        "Mod-Enter": (s, dispatch) => {
          const tr = blockAfter(s, me, now())
          if (tr && dispatch) dispatch(tr.scrollIntoView())
          return !!tr
        },
        Enter: (s, dispatch, v) => {
          if (finishesBlock(s)) {
            const tr = blockAfter(s, me, now())
            if (tr && dispatch) dispatch(tr.scrollIntoView())
            return true
          }
          const here = blockAt(s)
          if (here && isEmpty(here.node)) return true
          return splitBlock(s, dispatch, v)
        },
        Escape: (_s, _d, v) => {
          v?.dom.blur()
          return true
        },
      }),
      keymap(baseKeymap),
      looksPlugin(me),
      tidyPlugin(me),
    ],
  })
  return new EditorView(mount, {
    state,
    editable,
    attributes: { class: "doc", role: "textbox", "aria-multiline": "true", "aria-label": "Thread" },
    nodeViews: { block: (node) => new BlockView(node, heads) },
  })
}

function Head({ channel, attrs }: { channel: Channel; attrs: BlockAttrs }) {
  const { go } = useApp()
  if (!attrs.author) return null
  const who = channel.people.find((p) => p.name === attrs.author) ?? channel.former?.find((p) => p.name === attrs.author)
  return (
    <>
      <span className="blk-gutter">
        <Avatar person={who} />
        <time className="blk-time-hover" dateTime={new Date(attrs.at).toISOString()}>
          {clock(attrs.at)}
        </time>
      </span>
      <span className="blk-line">
        <button type="button" className="msg-name" onClick={() => go({ to: "modal", modal: { kind: "person", name: attrs.author } })}>
          {nickname(channel, attrs.author)}
        </button>
        {(attrs.kind === "tool" || attrs.kind === "comment") && <span className="blk-kind">{attrs.kind}</span>}
        <time className="msg-time" dateTime={new Date(attrs.at).toISOString()}>
          {clock(attrs.at)}
        </time>
      </span>
    </>
  )
}

export function ThreadDoc({ channel, where, shared }: { channel: Channel; where: Where; shared: Shared }) {
  const mount = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [heads] = useState(() => new Heads())
  const list = useSyncExternalStore(heads.subscribe, heads.snapshot)
  const me = channel.you
  const you = channel.people.find((p) => p.you)
  const readOnly = !!you?.readOnly
  const canWrite = useRef(!readOnly)
  useLayoutEffect(() => {
    canWrite.current = !readOnly
    view.current?.setProps({})
  }, [readOnly])

  useLayoutEffect(() => {
    const el = mount.current
    if (!el) return
    const v = makeView(el, shared, me, heads, () => canWrite.current)
    view.current = v
    if (canWrite.current && !document.activeElement?.closest("input, textarea, [contenteditable='true']")) {
      v.dispatch(startBlock(v.state, me, Date.now()))
      v.focus()
    }
    return () => {
      const tidy = dropEmptyOwn(v.state, me, null)
      if (tidy) v.dispatch(tidy)
      v.destroy()
      view.current = null
    }
  }, [shared, me, heads])

  useEffect(() => {
    shared.awareness.setLocalStateField("user", { name: nickname(channel, me), color: you?.color ?? "blue" })
  }, [shared, channel, me, you?.color])

  const place =
    where.kind === "room"
      ? `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}`
      : where.kind === "task"
        ? `T${where.task}`
        : where.kind === "dm"
          ? nickname(channel, where.with)
          : ""

  const write = () => {
    const v = view.current
    if (!v || !canWrite.current) return
    v.dispatch(startBlock(v.state, me, Date.now()).scrollIntoView())
    v.focus()
  }

  return (
    <div className={cx("thread-doc", readOnly && "is-read-only")} style={{ "--place": JSON.stringify(`Write in ${place}`) } as CSSProperties}>
      <div ref={mount} />
      {!readOnly && <button type="button" className="doc-tail" aria-label={`Write in ${place}`} onMouseDown={(e) => e.preventDefault()} onClick={write} />}
      {list.map(([el, key, attrs]) => createPortal(<Head channel={channel} attrs={attrs} />, el, String(key)))}
    </div>
  )
}

export function LocalThreadDoc({ channel, where, docKey }: { channel: Channel; where: Where; docKey: string }) {
  return <ThreadDoc channel={channel} where={where} shared={localDoc(docKey)} />
}
