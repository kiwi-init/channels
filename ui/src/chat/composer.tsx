import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { preview, useReplying } from "~/chat/reply"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, Where } from "~/model"
import { useApp } from "~/nav"
import { nickname, shown } from "~/names"

const SUGGEST = ["hey team, what's everyone on?", "who's working on what?", "add a dark mode toggle"]

const MENTION = /(^|\s)@([\p{L}\p{N}_.-]*)$/u

const drafts = new Map<string, string>()

export function Composer({ channel, where, placeholder, inThread, suggest }: { channel: Channel; where: Where; placeholder: string; inThread?: number; suggest?: boolean }) {
  const { app } = useApp()
  const replying = useReplying()
  const replyTo = replying?.to ?? null
  const key = `${channel.code}:${JSON.stringify(where)}:${inThread ?? ""}`
  const [text, setText] = useState(() => drafts.get(key) ?? "")
  const [caret, setCaret] = useState(text.length)
  const [pick, setPick] = useState(0)
  const [closed, setClosed] = useState(false)
  const [focused, setFocused] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const enterSends = app.prefs.enterSends

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  useEffect(() => {
    if (replyTo) area.current?.focus()
  }, [replyTo])

  const query = closed ? undefined : MENTION.exec(text.slice(0, caret))?.[2]
  const matches =
    query === undefined
      ? []
      : channel.people
          .filter((p) => !p.you && (p.name.toLowerCase().startsWith(query.toLowerCase()) || p.display?.toLowerCase().startsWith(query.toLowerCase())))
          .sort((a, b) => Number(b.presence === "online") - Number(a.presence === "online"))
          .slice(0, 6)

  const update = (value: string, at = value.length) => {
    setText(value)
    setCaret(at)
    setPick(0)
    setClosed(false)
    drafts.set(key, value)
  }
  const send = (value = text) => {
    const body = value.trim()
    if (!body) return
    const opts = { ...(inThread !== undefined ? { inThread } : {}), ...(replyTo ? { replyTo: replyTo.seq } : {}) }
    app.actions.send(channel.code, where, body, Object.keys(opts).length ? opts : undefined)
    replying?.set(null)
    update("")
  }
  const complete = (name: string) => {
    const before = text.slice(0, caret).replace(MENTION, (_all, pre: string) => `${pre}@${name} `)
    const next = before + text.slice(caret)
    update(next, before.length)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }

  const quoteLine = replyTo ? preview(replyTo.text) : ""

  return (
    <div className="compose">
      {suggest && !text && (
        <div className="suggests">
          {SUGGEST.map((s) => (
            <button key={s} type="button" className="suggest" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {matches.length > 0 && (
        <ul className="mentions" role="listbox" aria-label="People" id={`${key}-people`}>
          {matches.map((p, i) => (
            <li key={p.name} role="option" aria-selected={i === pick}>
              <button type="button" tabIndex={-1} className={cx("mention-row", i === pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => complete(p.name)}>
                <Avatar person={p} size="sm" pip />
                <span className="mention-name">{shown(p)}</span>
                <span className="dim">{p.role ?? p.runs ?? (p.kind === "human" ? "person" : "agent")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className={cx("composer", replyTo && "is-replying")}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        {replyTo && (
          <div className="compose-reply">
            <Icon name="reply" size={13} />
            <span className="compose-reply-text">
              Replying to <b>{nickname(channel, replyTo.from)}</b> <span className="dim">{quoteLine.slice(0, 160)}</span>
            </span>
            <button type="button" className="compose-reply-x" aria-label="Cancel reply" title="Cancel reply (Esc)" onClick={() => replying?.set(null)}>
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <div className="composer-row">
          <textarea
            ref={area}
            rows={1}
            value={text}
            aria-label="Message"
            aria-autocomplete="list"
            aria-expanded={matches.length > 0}
            aria-controls={matches.length > 0 ? `${key}-people` : undefined}
            placeholder={replyTo ? `Reply to ${nickname(channel, replyTo.from)}` : placeholder}
            onChange={(e) => update(e.target.value, e.target.selectionStart)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (matches.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault()
                  setPick((pick + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length)
                  return
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault()
                  const p = matches[pick]
                  if (p) complete(p.name)
                  return
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  e.stopPropagation()
                  setClosed(true)
                  return
                }
              }
              if (e.key === "Escape" && replyTo) {
                e.preventDefault()
                e.stopPropagation()
                replying?.set(null)
                return
              }
              if (e.key === "Enter" && (enterSends ? !e.shiftKey && !e.altKey : e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button type="submit" className={cx("send", text.trim() && "is-ready")} aria-label="Send" title={enterSends ? "Send (Enter)" : "Send (⌘ Enter)"} disabled={!text.trim()}>
            <Icon name="send" />
          </button>
        </div>
      </form>
      <p className={cx("compose-hint", (focused || text) && "is-on")} aria-hidden="true">
        <code>**bold**</code> <code>`code`</code> <code>- list</code> <span>·</span> {enterSends ? "Shift+Enter for a new line" : "⌘ Enter to send"}
      </p>
    </div>
  )
}
