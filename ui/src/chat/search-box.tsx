import { marks, terms } from "@kiwi/core/search-rank.ts"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"

import "~/styles/search.css"
import { hitKey, hitText, messageIndex, searchHits, whereLabel, type Hit } from "~/chat/search-hits"
import { cx, Dot } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel, Message } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"

const SETTLE_MS = 150

export interface Jump {
  m: Message
  terms: string[]
}

function useSettled(value: string): string {
  const [settled, setSettled] = useState(value)
  const now = !value.trim()
  if (now && settled !== value) setSettled(value)
  useEffect(() => {
    if (now) return
    const t = window.setTimeout(() => setSettled(value), SETTLE_MS)
    return () => window.clearTimeout(t)
  }, [value, now])
  return now ? value : settled
}

function Marked({ text, wanted }: { text: string; wanted: string[] }) {
  return marks(text, wanted).map((s, i) =>
    s.hit ? (
      <mark key={i} className="search-mark">
        {s.text}
      </mark>
    ) : (
      s.text
    )
  )
}

export function SearchBox({ channel, focusAsk, onJump, onClose }: { channel: Channel; focusAsk: number; onJump: (jump: Jump | null) => void; onClose: () => void }) {
  const { go } = useApp()
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(true)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const settled = useSettled(query)
  const index = useMemo(() => messageIndex(channel), [channel])
  const hits = useMemo(() => searchHits(channel.tasks, index, settled), [channel.tasks, index, settled])
  const wanted = useMemo(() => terms(settled), [settled])
  const [hitsWere, setHitsWere] = useState(hits)
  if (hitsWere !== hits) {
    setHitsWere(hits)
    setActive(0)
  }
  const current = Math.min(active, Math.max(0, hits.length - 1))
  const open = focused && settled.trim() !== ""
  const optionId = (i: number) => `${listId}-${i}`

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [current, hits])

  useEffect(() => {
    if (focusAsk) input.current?.focus()
  }, [focusAsk])

  const pick = (hit: Hit) => {
    setFocused(false)
    input.current?.blur()
    if (hit.kind === "task") {
      onJump(null)
      go({ to: "panel", panel: { kind: "task", task: hit.task.id } })
      return
    }
    go({ to: "where", where: hit.m.where })
    onJump({ m: hit.m, terms: wanted })
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setFocused(true)
      if (hits.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const hit = hits[current]
      if (open && hit) pick(hit)
    }
  }

  const firstMessage = hits.findIndex((h) => h.kind === "message")
  return (
    <div className="search">
      <div className="search-field" role="search">
        <Icon name="search" />
        <input
          ref={input}
          autoFocus
          className="search-input"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search this channel"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setFocused(true)
            onJump(null)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (!query) onClose()
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-label="Search this channel"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && hits.length ? optionId(current) : undefined}
        />
        {query !== "" && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            title="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("")
              onJump(null)
              input.current?.focus()
            }}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {open && (
        <div ref={listRef} id={listId} className="search-pop" role="listbox" aria-label="Search results">
          {hits.length === 0 && <p className="search-none">Nothing matches “{settled.trim()}”.</p>}
          {hits.map((hit, i) => (
            <div key={hitKey(hit)}>
              {i === 0 && hit.kind === "task" && (
                <div className="search-heading" aria-hidden="true">
                  Tasks
                </div>
              )}
              {i === firstMessage && (
                <div className="search-heading" aria-hidden="true">
                  Messages
                </div>
              )}
              <div
                id={optionId(i)}
                className={cx("search-item", i === current && "is-on")}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => i !== current && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(hit)}
              >
                {hit.kind === "task" ? (
                  <>
                    <span className="search-id">T{hit.task.id}</span>
                    <span className="search-title">
                      <Marked text={hit.task.title} wanted={wanted} />
                    </span>
                    <Dot status={hit.task.status} />
                  </>
                ) : (
                  <span className="search-msg">
                    <span className="search-line">
                      <span className="search-who">
                        <Marked text={nickname(channel, hit.m.from)} wanted={wanted} />
                      </span>
                      <span className="search-where">{whereLabel(channel, hit.m.where)}</span>
                      <span className="search-when">{ago(hit.m.at)}</span>
                    </span>
                    <span className="search-text">
                      <Marked text={hitText(hit.m.text, wanted)} wanted={wanted} />
                    </span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
