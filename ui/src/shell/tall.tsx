import { useCallback, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"

import { Conversation } from "~/chat/conversation"
import type { Jump } from "~/chat/search-box"
import { Avatar, cx, Dot } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel } from "~/model"
import { useApp } from "~/nav"
import { shown } from "~/names"
import { statusOf, taskOf, toneOf } from "~/shell/sidebar"

const KEY = "channels.tall.work"
const SHARE = 0.42
const MIN = 160
const MIN_CHAT = 280

const onResize = (l: () => void) => (window.addEventListener("resize", l), () => window.removeEventListener("resize", l))

const useWindowHeight = (): number => useSyncExternalStore(onResize, () => window.innerHeight)

const room = (h: number, windowHeight: number): number => Math.round(Math.max(MIN, Math.min(h, windowHeight - MIN_CHAT - 160)))

function stored(): number {
  try {
    return Number(localStorage.getItem(KEY)) || Math.round(window.innerHeight * SHARE)
  } catch {
    // Storage can be off (private windows, blocked site data): start at the default share of the window.
    return Math.round(window.innerHeight * SHARE)
  }
}

function keep(h: number): void {
  try {
    localStorage.setItem(KEY, String(h))
  } catch {
    // Storage can be off: the split just isn't remembered.
  }
}

function useSplit() {
  const [wanted, setWanted] = useState(stored)
  const height = room(wanted, useWindowHeight())
  const set = useCallback((h: number) => {
    const next = room(h, window.innerHeight)
    setWanted(next)
    keep(next)
  }, [])
  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const grip = e.currentTarget
      grip.setPointerCapture(e.pointerId)
      const from = e.clientY
      const start = height
      document.documentElement.dataset.resizing = "split"
      const move = (ev: globalThis.PointerEvent) => set(start + ev.clientY - from)
      const up = () => {
        grip.removeEventListener("pointermove", move)
        grip.removeEventListener("pointerup", up)
        grip.removeEventListener("pointercancel", up)
        delete document.documentElement.dataset.resizing
      }
      grip.addEventListener("pointermove", move)
      grip.addEventListener("pointerup", up)
      grip.addEventListener("pointercancel", up)
    },
    [height, set]
  )
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 64 : 16
      if (e.key === "ArrowDown") set(height + step)
      else if (e.key === "ArrowUp") set(height - step)
      else return
      e.preventDefault()
    },
    [height, set]
  )
  return { height, grip: { onPointerDown, onKeyDown, onDoubleClick: () => set(Math.round(window.innerHeight * SHARE)) } }
}

function Crew({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const agents = channel.people.filter((p) => p.kind === "agent" && !p.left)
  return (
    <nav className="crew" aria-label="Agents">
      {agents.map((p) => {
        const on = nav.panel?.kind === "person" && nav.panel.name === p.name
        const task = taskOf(p, channel)
        return (
          <button
            key={p.name}
            type="button"
            className={cx("crew-agent", on && "is-on", p.presence === "offline" && "is-off")}
            aria-pressed={on}
            onClick={() => go({ to: "panel", panel: on ? null : { kind: "person", name: p.name } })}
          >
            <Avatar person={p} size="sm" pip />
            <span className="crew-name">{shown(p)}</span>
            <span className={cx("crew-status", toneOf(p, channel))}>{statusOf(p, channel)}</span>
            <span className="crew-task">
              {task ? (
                <>
                  <Dot status={task.status} />
                  <span className="num">T{task.id}</span> {task.title}
                </>
              ) : (
                <span className="crew-idle">no task</span>
              )}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        className={cx("crew-add", nav.panel?.kind === "add-agent" && "is-on")}
        aria-label="Add agent"
        title="Add agent"
        onClick={() => go({ to: "panel", panel: { kind: "add-agent" } })}
      >
        <Icon name="plus" size={14} />
      </button>
    </nav>
  )
}

export default function TallPage({ channel, jump, work, open }: { channel: Channel; jump: Jump | null; work: ReactNode; open: ReactNode }) {
  const split = useSplit()
  return (
    <div className="tall" style={{ "--work-h": `${split.height}px` } as CSSProperties}>
      <Crew channel={channel} />
      <section className={cx("tall-work", open != null && "is-open")} aria-label={open != null ? "Details" : "Tasks"}>
        {open ?? work}
      </section>
      <div className="tall-grip" role="separator" aria-orientation="horizontal" aria-label="Resize tasks and chat" tabIndex={0} title="Drag to resize · double-click to reset" {...split.grip} />
      <section className="tall-chat" aria-label="Conversation">
        <Conversation channel={channel} jump={jump} />
      </section>
    </div>
  )
}
