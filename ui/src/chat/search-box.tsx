import "~/i18n/en/chat-later"
import { marks, terms } from "@kiwi/core/search-rank.ts"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"

import "~/styles/search.css"
import { hitKey, hitText, messageIndex, searchHits, whereLabel, type Hit } from "~/chat/search-hits"
import { t } from "~/i18n/i18n"
import { cx, Dot } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel, Message, OlderSearch } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"
import { wordsPlain, wrote } from "~/words"

const SETTLE_MS = 150
const OLDER_SHOWN = 30
const FETCH_HIT: Hit = { kind: "fetch" }

type Pull = { asked: number; until?: number } | { failed: string }

const date = (at: number) => new Date(at).toLocaleDateString([], { month: "short", day: "numeric", ...(new Date(at).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) })

export interface Jump {
  m: Message
  terms: string[]
}

export interface Older {
  seq: number
  terms: string[]
}

function useSettled(value: string): string {
  const [settled, setSettled] = useState(value)
  const now = !value.trim()
  if (now && settled !== value) setSettled(value)
  useEffect(() => {
    if (now) return
    const timer = window.setTimeout(() => setSettled(value), SETTLE_MS)
    return () => window.clearTimeout(timer)
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

export function SearchBox({
  channel,
  focusAsk,
  onJump,
  onOlder,
  onClose,
}: {
  channel: Channel
  focusAsk: number
  onJump: (jump: Jump | null) => void
  onOlder: (older: Older) => void
  onClose: () => void
}) {
  const { go, app } = useApp()
  const actions = app.actions
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(true)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const settled = useSettled(query)
  const index = useMemo(() => messageIndex(channel), [channel])
  const recent = useMemo(() => searchHits(channel.tasks, index, settled), [channel.tasks, index, settled])
  const before = useMemo(() => channel.since ?? channel.messages.reduce((low, m) => (m.seq > 0 && m.seq < low ? m.seq : low), Number.MAX_SAFE_INTEGER), [channel.since, channel.messages])
  const [older, setOlder] = useState<{ query: string; found: OlderSearch } | null>(null)
  const [pull, setPull] = useState<Pull | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    const q = settled.trim()
    if (!q) return
    let gone = false
    const settle = (found: OlderSearch) => {
      setOlder({ query: q, found })
      setPull((p) => (p && "until" in p && p.until !== undefined && p.until <= round ? null : p))
    }
    void actions.searchOlder(channel.code, q, before).then(
      (found: OlderSearch) => !gone && settle(found),
      () => !gone && settle({ state: "none", hits: [], more: null })
    )
    return () => {
      gone = true
    }
  }, [actions, channel.code, settled, before, round])
  const olderNow = older?.query === settled.trim() ? older.found : null
  const more = olderNow?.state !== "none" ? (olderNow?.more ?? null) : null
  const hits = useMemo((): Hit[] => {
    const seen = new Set(recent.flatMap((h) => (h.kind === "message" ? [h.m.seq] : [])))
    const olderHits = (olderNow?.hits ?? []).filter((o) => !seen.has(o.seq))
    return [...recent, ...olderHits.slice(0, OLDER_SHOWN).map((o): Hit => ({ kind: "older", o })), ...(more ? [FETCH_HIT] : [])]
  }, [recent, olderNow, more])
  const found = hits.filter((h) => h.kind !== "fetch").length
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

  const fetchOlder = () => {
    if (pull && "asked" in pull) return
    const next = round + 1
    setPull({ asked: 0 })
    void actions
      .fetchOlder(channel.code, (asked) => setPull({ asked }))
      .then(
        () => {
          setPull((p) => (p && "asked" in p ? { ...p, until: next } : p))
          setRound(next)
        },
        (err: unknown) => setPull({ failed: err instanceof Error ? err.message : String(err) })
      )
  }

  const pick = (hit: Hit) => {
    if (hit.kind === "fetch") return fetchOlder()
    setFocused(false)
    input.current?.blur()
    if (hit.kind === "task") {
      onJump(null)
      go({ to: "panel", panel: { kind: "task", task: hit.task.id } })
      return
    }
    const since = channel.since
    const at = hit.kind === "older" ? hit.o.seq : hit.m.seq
    if (since === undefined || at <= 0 || at >= since) {
      if (hit.kind === "older") {
        onJump(null)
        onOlder({ seq: at, terms: wanted })
        return
      }
      go({ to: "where", where: hit.m.where, jump: true })
      onJump({ m: hit.m, terms: wanted })
      return
    }
    onJump(null)
    void actions.earlierTo(channel.code, at).then((held) => {
      if (!held) return onOlder({ seq: at, terms: wanted })
      const where = hit.kind === "older" ? hit.o.where : hit.m.where
      go({ to: "where", where, jump: true })
      onJump({ m: hit.kind === "message" ? hit.m : { seq: at, from: hit.o.from, at: hit.o.at, text: wrote(hit.o.text), where }, terms: wanted })
    })
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
  const firstOlder = hits.findIndex((h) => h.kind === "older")
  const olderMore = olderNow ? olderNow.hits.length - OLDER_SHOWN : 0
  const notes = (
    <>
      {olderMore > 0 && <p className="search-note">{t("chat.search.box.more.older", { count: olderMore })}</p>}
      {olderNow?.state === "indexing" && <p className="search-note">{t("chat.search.box.indexing")}</p>}
    </>
  )
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
          placeholder={t("chat.search.box.placeholder")}
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
          aria-label={t("chat.search.box.placeholder")}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && hits.length ? optionId(current) : undefined}
        />
        {query !== "" && (
          <button
            type="button"
            className="search-clear"
            aria-label={t("chat.search.box.clear")}
            title={t("chat.search.box.clear")}
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
        <div ref={listRef} id={listId} className="search-pop" role="listbox" aria-label={t("chat.search.box.results")}>
          {found === 0 && olderNow?.state !== "indexing" && <p className="search-none">{t("chat.search.box.nothing", { query: settled.trim() })}</p>}
          {hits.map((hit, i) => (
            <div key={hitKey(hit)}>
              {i === 0 && hit.kind === "task" && (
                <div className="search-heading" aria-hidden="true">
                  {t("chat.search.box.tasks")}
                </div>
              )}
              {i === firstMessage && (
                <div className="search-heading" aria-hidden="true">
                  {t("chat.search.box.messages")}
                </div>
              )}
              {hit.kind === "fetch" && notes}
              {i === firstOlder && (
                <div className="search-heading" aria-hidden="true">
                  {t("chat.search.box.older", { count: olderNow?.hits.length ?? 0 })}
                </div>
              )}
              <div
                id={optionId(i)}
                className={cx("search-item", hit.kind === "fetch" && "is-fetch", i === current && "is-on")}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => i !== current && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(hit)}
              >
                {hit.kind === "fetch" ? (
                  <FetchRow pull={pull} since={more?.since ?? null} upTo={more?.upTo ?? 0} />
                ) : hit.kind === "older" ? (
                  <span className="search-msg">
                    <span className="search-line">
                      <span className="search-who">
                        <Marked text={nickname(channel, hit.o.from)} wanted={wanted} />
                      </span>
                      <span className="search-where">{whereLabel(channel, hit.o.where)}</span>
                      <span className="search-when">{ago(hit.o.at)}</span>
                    </span>
                    <span className="search-text">
                      <Marked text={hitText(hit.o.text, wanted)} wanted={wanted} />
                    </span>
                  </span>
                ) : hit.kind === "task" ? (
                  <>
                    <span className="search-id">T{hit.task.id}</span>
                    <span className="search-title">
                      <Marked text={wordsPlain(hit.task.title, channel.nicknames)} wanted={wanted} />
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
                      <Marked text={hitText(wordsPlain(hit.m.text, channel.nicknames), wanted)} wanted={wanted} />
                    </span>
                  </span>
                )}
              </div>
            </div>
          ))}
          {!more && notes}
        </div>
      )}
    </div>
  )
}

function FetchRow({ pull, since, upTo }: { pull: Pull | null; since: number | null; upTo: number }) {
  const asked = pull && "asked" in pull ? pull.asked : null
  return (
    <span className="search-msg search-fetch" aria-busy={asked !== null}>
      <span className="search-line">
        <Icon name="download" size={14} />
        <span className="search-who">{asked === null ? t("chat.search.box.search.older") : t("chat.search.box.fetching")}</span>
      </span>
      <span className="search-text">
        {asked !== null
          ? t("chat.search.box.progress", { asked, upTo })
          : pull && "failed" in pull
            ? t("chat.search.box.fetch.failed", { error: pull.failed })
            : since
              ? t("chat.search.box.fetches.since", { date: date(since), count: upTo })
              : t("chat.search.box.fetches", { count: upTo })}
      </span>
    </span>
  )
}
