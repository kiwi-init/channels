import { useLayoutEffect, useRef, useState } from "react"

import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, Where } from "~/model"
import { useApp } from "~/nav"

const SUGGEST = ["hey team, what's everyone on?", "who's working on what?", "add a dark mode toggle"]

const drafts = new Map<string, string>()

export function Composer({ channel, where, placeholder, inThread, suggest }: { channel: Channel; where: Where; placeholder: string; inThread?: number; suggest?: boolean }) {
  const { app, toast } = useApp()
  const key = `${channel.code}:${JSON.stringify(where)}:${inThread ?? ""}`
  const [text, setText] = useState(() => drafts.get(key) ?? "")
  const [pick, setPick] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [text])

  const query = /(?:^|\s)@([\w.-]*)$/.exec(text)?.[1]
  const matches = query === undefined ? [] : channel.people.filter((p) => !p.you && p.name.startsWith(query.toLowerCase())).slice(0, 6)

  const update = (value: string) => {
    setText(value)
    setPick(0)
    drafts.set(key, value)
  }
  const send = (value = text) => {
    const body = value.trim()
    if (!body) return
    app.actions.send(channel.code, where, body, inThread ? { inThread } : undefined)
    update("")
  }
  const complete = (name: string) => {
    update(text.replace(/@([\w.-]*)$/, `@${name} `))
    area.current?.focus()
  }

  return (
    <div className="compose">
      {suggest && (
        <div className="suggests">
          {SUGGEST.map((s) => (
            <button key={s} type="button" className="suggest" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {matches.length > 0 && (
        <ul className="mentions" role="listbox" aria-label="People">
          {matches.map((p, i) => (
            <li key={p.name} role="option" aria-selected={i === pick}>
              <button type="button" className={cx("mention-row", i === pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => complete(p.name)}>
                <Avatar person={p} size="sm" />
                <span>{p.name}</span>
                <span className="dim">{p.role ?? p.runs ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <button type="button" className="icon-btn" aria-label="Attach an image" title="Attach an image" onClick={() => toast("Pick, paste or drop an image")}>
          <Icon name="attach" />
        </button>
        <textarea
          ref={area}
          rows={1}
          value={text}
          aria-label="Message"
          placeholder={placeholder}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
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
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button type="submit" className="send" aria-label="Send" disabled={!text.trim()}>
          <Icon name="send" />
        </button>
      </form>
    </div>
  )
}
