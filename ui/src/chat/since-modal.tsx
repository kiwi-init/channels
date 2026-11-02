import "~/styles/since.css"

import { useState } from "react"

import { Dialog, DialogHead } from "~/kit/bits"

import { sinceYouLeft, type SincePlace } from "~/chat/since"
import { ago } from "~/kit/time"
import type { Channel, Task } from "~/model"
import { between, nickname } from "~/names"
import { useApp } from "~/nav"

const SHOWN_NAMES = 4
const SHOWN_TASKS = 5

function names(channel: Channel, who: readonly string[]): string {
  const shown = who.slice(0, SHOWN_NAMES).map((w) => nickname(channel, w))
  return who.length > SHOWN_NAMES ? `${shown.join(", ")} +${who.length - SHOWN_NAMES}` : shown.join(", ")
}

function snippet(channel: Channel, p: SincePlace): string {
  if (p.last.locked) return `${nickname(channel, p.last.from)}: sealed`
  const text = p.last.text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return `${nickname(channel, p.last.from)}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function placeName(channel: Channel, p: SincePlace): string {
  const w = p.where
  if (w.kind === "room") return `#${channel.rooms.find((r) => r.id === w.room)?.name ?? w.room}`
  if (w.kind === "dm") return `you ↔ ${nickname(channel, w.with)}`
  if (w.kind === "theirs") return between(channel, w.between)
  return `T${w.task}`
}

const AWAY_MS = 30 * 60_000

const away = (at: number): string => {
  const a = ago(at)
  return /^\d/.test(a) ? `from ${a} ago` : `since ${a}`
}
const SHOWN_KEY = (code: string) => `kiwi.since.${code}`

function shownBefore(code: string, seq: number): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY(code)) === String(seq)
  } catch {
    // Storage that can't be read shows it this once, as if it were new.
    return false
  }
}

function markShown(code: string, seq: number): void {
  try {
    localStorage.setItem(SHOWN_KEY(code), String(seq))
  } catch {
    // Storage that can't be written only means it may show again next launch.
  }
}

export default function SinceModal({ channel }: { channel: Channel }) {
  const { app, go } = useApp()
  const [since] = useState(() => {
    const s = sinceYouLeft(channel)
    return s && Date.now() - s.at >= AWAY_MS && !shownBefore(channel.code, s.seq) ? s : null
  })
  const [open, setOpen] = useState(!!since)
  const [dms, setDms] = useState(false)
  if (!since) return null
  const close = () => {
    markShown(channel.code, since.seq)
    setOpen(false)
  }
  const goTo = (to: Parameters<typeof go>[0]) => {
    close()
    go(to)
  }
  const dmCount = since.dms.reduce((n, p) => n + p.count, 0)
  const dmWho = [...new Set(since.dms.flatMap((p) => p.who))]
  const { done, doing, waiting } = since.tasks
  const ids: Task[] = [...waiting, ...doing, ...done].slice(0, SHOWN_TASKS)
  const seeAll = () => {
    for (const p of since.rooms) app.actions.markRead(channel.code, p.where)
    for (const p of since.dms) if (p.where.kind === "dm") app.actions.markRead(channel.code, p.where)
    close()
  }
  return (
    <Dialog open={open} onClose={close} label="Since you left" wide>
      <DialogHead title="Since you left" sub={`${channel.title} · ${away(since.at)}`} onClose={close} />
      <dl className="since-rows">
        {since.rooms.map((p) => (
          <div key={placeName(channel, p)} className="since-row">
            <dt className="since-label">{placeName(channel, p)}</dt>
            <dd className="since-what">
              <button type="button" className="since-link" onClick={() => goTo({ to: "where", where: p.where })}>
                <b>{plural(p.count, "message")}</b> · {names(channel, p.who)}
              </button>
              <span className="since-last">{snippet(channel, p)}</span>
            </dd>
          </div>
        ))}
        {since.dms.length > 0 && (
          <div className="since-row">
            <dt className="since-label">Direct</dt>
            <dd className="since-what">
              <button type="button" className="since-link" aria-expanded={dms} onClick={() => setDms((o) => !o)}>
                <b>{plural(dmCount, "message")}</b> in {plural(since.dms.length, "DM")} <span className="since-caret">{dms ? "▴" : "▾"}</span>
              </button>
              <span className="since-last">{names(channel, dmWho)}</span>
              {dms && (
                <ul className="since-dms">
                  {since.dms.map((p) => (
                    <li key={placeName(channel, p)}>
                      <button type="button" className="since-dm" onClick={() => goTo({ to: "where", where: p.where })}>
                        <span className="since-dm-who">{placeName(channel, p)}</span>
                        <span className="since-dm-text">{snippet(channel, p)}</span>
                        <span className="since-dm-n">{p.count}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        )}
        {done.length + doing.length + waiting.length > 0 && (
          <div className="since-row">
            <dt className="since-label">Tasks</dt>
            <dd className="since-what">
              <button type="button" className="since-link" onClick={() => goTo({ to: "tab", tab: "tasks" })}>
                <b>{done.length}</b> done · <b>{doing.length}</b> in progress
                {waiting.length > 0 && <span className="since-waiting"> · {waiting.length} waiting on someone</span>}
              </button>
              <span className="since-tasks">
                {ids.map((t) => (
                  <button key={t.id} type="button" className="since-task" title={t.title} onClick={() => goTo({ to: "panel", panel: { kind: "task", task: t.id } })}>
                    T{t.id}
                  </button>
                ))}
              </span>
            </dd>
          </div>
        )}
      </dl>
      <div className="dialog-foot">
        <button type="button" className="btn" onClick={close}>
          Close
        </button>
        <button type="button" className="btn is-primary" onClick={seeAll}>
          Mark all seen
        </button>
      </div>
    </Dialog>
  )
}
