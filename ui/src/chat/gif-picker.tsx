import { useCallback, useEffect, useRef, useState } from "react"

import { gifFile, gifHost, useCatalog, useGifSrc, type Catalog, type Gif } from "~/chat/gifs"
import { cx } from "~/kit/bits"
import type { Channel, Message, Reaction } from "~/model"
import { useAct, useApp } from "~/nav"
import { nickname } from "~/names"

interface ForCompose {
  onFile: (file: File | null) => void
}

interface ForMessage {
  channel: Channel
  m: Message
  r?: Reaction
}

export default function Gifs(props: ForCompose | ForMessage) {
  const host = gifHost(useApp().app.account?.relay)
  const catalog = useCatalog(host)
  if (!catalog) return null
  if (!("m" in props)) return <GifButton host={host} catalog={catalog} onFile={props.onFile} />
  return props.r ? <GifReaction channel={props.channel} m={props.m} r={props.r} catalog={catalog} /> : <GifTool channel={props.channel} m={props.m} catalog={catalog} />
}

function GifButton({ host, catalog, onFile }: { host: string; catalog: Catalog; onFile: (file: File | null) => void }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <button type="button" className="compose-attach" aria-label="GIFs" title="GIFs" aria-expanded={open} data-gif-toggle onClick={() => setOpen((v) => !v)}>
        <span className="gif-mark">GIF</span>
      </button>
      {open && <GifPicker catalog={catalog} className="gifs-on-compose" onClose={close} onPick={(g) => void gifFile(host, g).then(onFile, () => onFile(null))} />}
    </>
  )
}

function GifTool({ channel, m, catalog }: { channel: Channel; m: Message; catalog: Catalog }) {
  const { actions } = useAct()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <button type="button" className="msg-tool" aria-label="React with a GIF" title="React with a GIF" aria-expanded={open} data-gif-toggle onClick={() => setOpen((v) => !v)}>
        <span className="gif-mark">GIF</span>
      </button>
      {open && <GifPicker catalog={catalog} className="gifs-on-msg" onClose={close} onPick={(g) => actions.react(channel.code, m.seq, g.key)} />}
    </>
  )
}

function GifPicker({ catalog, className, onClose, onPick }: { catalog: Catalog; className: string; onClose: () => void; onPick: (g: Gif) => void }) {
  const [tab, setTab] = useState(catalog.groups[0]?.reaction ?? "")
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      onClose()
    }
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || box.current?.contains(e.target) || e.target.closest("[data-gif-toggle]")) return
      onClose()
    }
    document.addEventListener("keydown", esc, true)
    document.addEventListener("pointerdown", outside, true)
    return () => {
      document.removeEventListener("keydown", esc, true)
      document.removeEventListener("pointerdown", outside, true)
    }
  }, [onClose])
  const group = catalog.groups.find((g) => g.reaction === tab)
  return (
    <div ref={box} role="dialog" aria-label="GIFs" className={cx("gifs", className)}>
      <div role="tablist" aria-label="Feelings" className="gifs-tabs">
        {catalog.groups.map((g) => (
          <button key={g.reaction} type="button" role="tab" aria-selected={g.reaction === tab} className={cx("gifs-tab", g.reaction === tab && "is-on")} onClick={() => setTab(g.reaction)}>
            {g.reaction.replace(/-/g, " ")}
            <span className="num">{g.items.length}</span>
          </button>
        ))}
      </div>
      <div className="gifs-grid">
        {group?.items.map((g) => (
          <button
            key={g.key}
            type="button"
            className="gifs-item"
            title={g.feeling}
            aria-label={`${g.reaction}: ${g.feeling}`}
            onClick={() => {
              onClose()
              onPick(g)
            }}
          >
            <GifImg g={g} />
            <span className="gifs-feeling">{g.feeling}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function GifReaction({ channel, m, r, catalog }: { channel: Channel; m: Message; r: Reaction; catalog: Catalog }) {
  const gif = catalog.byKey(r.emoji)
  if (!gif) return null
  return <GifChip channel={channel} m={m} r={r} gif={gif} />
}

function GifImg({ g }: { g: Gif }) {
  const src = useGifSrc(gifHost(useApp().app.account?.relay), g)
  return src ? <img src={src} alt="" /> : <span className="gif-wait" aria-hidden="true" />
}

function GifChip({ channel, m, r, gif }: { channel: Channel; m: Message; r: Reaction; gif: Gif }) {
  const { actions } = useAct()
  const who = r.by.map((b) => nickname(channel, b)).join(", ")
  const mine = r.by.includes(channel.you)
  return (
    <button
      type="button"
      className={cx("react-gif", mine && "is-mine")}
      title={`${gif.feeling} · ${who}`}
      aria-label={`${gif.feeling}, from ${who}`}
      aria-pressed={mine}
      disabled={m.where.kind === "theirs"}
      onClick={() => actions.react(channel.code, m.seq, r.emoji)}
    >
      <GifImg g={gif} />
      <span className="react-gif-who">{who}</span>
    </button>
  )
}
