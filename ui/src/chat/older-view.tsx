import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react"

import "~/styles/search.css"
import { useNames, useTaskIds } from "~/chat/conversation"
import { MessageRow } from "~/chat/message"
import type { Older } from "~/chat/search-box"
import { whereLabel } from "~/chat/search-hits"
import { paintHits } from "~/chat/search-paint"
import { Loading } from "~/kit/bits"
import { day, sameDay } from "~/kit/time"
import type { Channel, Message, OlderHit } from "~/model"
import { useApp } from "~/nav"

const asMessage = (o: OlderHit): Message => ({ seq: o.seq, from: o.from, at: o.at, text: o.text, where: o.where })

export function OlderView({ channel, older, onBack }: { channel: Channel; older: Older; onBack: () => void }) {
  const { app } = useApp()
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const [loaded, setLoaded] = useState<{ seq: number; rows: OlderHit[] | null } | null>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let gone = false
    void app.actions.olderAround(channel.code, older.seq).then(
      (rows: OlderHit[] | null) => !gone && setLoaded({ seq: older.seq, rows }),
      () => !gone && setLoaded({ seq: older.seq, rows: null })
    )
    return () => {
      gone = true
    }
  }, [app.actions, channel.code, older.seq])

  const rows = loaded?.seq === older.seq ? loaded.rows : undefined
  const hitAt = rows?.find((o) => o.seq === older.seq)?.at
  useLayoutEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-seq="${older.seq}"]`)
    if (!row) return
    row.scrollIntoView({ block: "center" })
    paintHits(row.querySelector<HTMLElement>(".msg-text") ?? row, older.terms)
    row.classList.add("is-flash")
  }, [rows, older.seq, older.terms])

  return (
    <div className="feed-wrap older">
      <div className="older-bar" role="status">
        <span>Viewing older messages{hitAt ? ` around ${day(hitAt)}` : ""}</span>
        <button type="button" className="btn is-small" onClick={onBack}>
          Back to latest
        </button>
      </div>
      <div className="feed">
        <div className="feed-list" ref={list}>
          {rows === undefined ? (
            <Loading />
          ) : rows === null || rows.length === 0 ? (
            <p className="search-none">That part of the history isn't on this device yet.</p>
          ) : (
            rows.map((o, i) => (
              <Fragment key={o.seq}>
                {(i === 0 || !sameDay(rows[i - 1]?.at ?? 0, o.at)) && (
                  <p className="day">
                    <span>{day(o.at)}</span>
                  </p>
                )}
                {(i === 0 || whereLabel(channel, rows[i - 1]!.where) !== whereLabel(channel, o.where)) && <p className="older-where">{whereLabel(channel, o.where)}</p>}
                <MessageRow channel={channel} m={asMessage(o)} compact={i > 0 && rows[i - 1]?.from === o.from && sameDay(rows[i - 1]!.at, o.at)} names={names} tasks={tasks} />
              </Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
