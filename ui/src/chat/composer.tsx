import { lazy, Suspense, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import { AttachedFiles, DropHint, IMAGE_TYPES, useAttach } from "~/chat/attach"
import { matchCommands, parseCommand } from "~/chat/commands"
import { useCommands } from "~/chat/use-commands"
import { EditHere, startEditing, stopEditing, useEditingIn } from "~/chat/editing"
import { lastOwn, nextEdit, type Edit } from "~/chat/compose-edit"
import { withExcerpt } from "~/chat/quote"
import { sayerAt } from "~/chat/doc/sayer"
import { preview, useReplying } from "~/chat/reply"
import { attached, composerKey, drafts, giveBack, tooLong, useGivenBack, useRestored } from "~/chat/drafts"
import { composing, sendsOn, sendTitle } from "~/chat/send-keys"
import { STASH_SHOT, stashText, useStash } from "~/chat/stash"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { openMenu } from "~/kit/menu-open"
import type { Channel, Upload, Where } from "~/model"
import { useActions, useAppPrefs, useToast } from "~/nav"
import { nickname } from "~/names"
import { withNames } from "~/chat/linked"
import { listId, Suggestions, useSuggest } from "~/chat/suggest"
import { wordsRaw } from "~/words"

const Gifs = lazy(() => import("~/chat/gif-picker"))
const StashList = lazy(() => import("~/chat/stash-list"))

type Cue = { key: string; back: boolean; left: number; lost?: number }

function placeOf(channel: Channel, where: Where, inThread?: number): string {
  if (inThread !== undefined) return t("chat.composer.this.thread")
  if (where.kind === "room") return `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}`
  if (where.kind === "task") return `T${where.task}`
  if (where.kind === "dm") return t("chat.composer.your.chat.with", { name: nickname(channel, where.with) })
  return t("chat.composer.here")
}

type ComposerProps = { channel: Channel; where: Where; placeholder: string; inThread?: number; doc?: string | null }

export function Composer(props: ComposerProps) {
  return <ComposerIn key={composerKey(props.channel.code, props.where, props.inThread)} {...props} />
}

function ComposerIn({ channel, where, placeholder, inThread, doc }: ComposerProps) {
  const actions = useActions()
  const prefs = useAppPrefs()
  const toast = useToast()
  const replying = useReplying()
  const replyTo = replying?.to ?? null
  const excerpt = replyTo ? (replying?.excerpt ?? null) : null
  const key = composerKey(channel.code, where, inThread)
  const [text, setText] = useState(() => drafts.get(key) ?? "")
  const area = useRef<HTMLTextAreaElement>(null)
  const s = useSuggest({ channel, id: key, text, area, onText: (value, at) => update(value, at) })
  const moved = s.moved
  const box = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [files, setFilesNow] = useState<Upload[]>(() => attached.get(key) ?? [])
  const setFiles = (next: Upload[] | ((now: Upload[]) => Upload[])) =>
    setFilesNow((now) => {
      const list = typeof next === "function" ? next(now) : next
      if (list.length) attached.set(key, list)
      else attached.delete(key)
      return list
    })
  const back = useGivenBack(key)
  const seenBack = useRef(back)
  useEffect(() => {
    if (back === seenBack.current) return
    seenBack.current = back
    const got = drafts.get(key) ?? ""
    setText(got)
    moved(got.length)
    setFilesNow(attached.get(key) ?? [])
    area.current?.focus()
  }, [back, key, moved])
  const restored = useRestored()
  const [seenRestored, setSeenRestored] = useState(restored)
  if (seenRestored !== restored) {
    setSeenRestored(restored)
    const kept = files.length ? undefined : attached.get(key)
    if (kept) setFilesNow(kept)
  }
  const [alsoRoom, setAlsoRoom] = useState(false)
  const enterSends = prefs.enterSends
  const stash = useStash(key)
  const [cueOf, setCue] = useState<Cue | null>(() => (STASH_SHOT === "stash" ? { key, back: false, left: stash.list.length } : null))
  const cue = cueOf?.key === key ? cueOf : null
  const [listOf, setListOf] = useState<string | null>(() => (STASH_SHOT === "stash-open" ? key : null))
  const listOpen = listOf === key && stash.list.length > 0
  const plus = useRef<HTMLButtonElement>(null)
  const [gifsOpen, setGifsOpen] = useState(false)
  const [gifsReady, setGifsReady] = useState(false)
  const closeGifs = useCallback(() => setGifsOpen(false), [])
  const addMenu = () => {
    if (gifsOpen) return setGifsOpen(false)
    const at = plus.current?.getBoundingClientRect()
    if (!at) return
    const image = { label: t("chat.composer.image"), run: () => picker.current?.click() }
    const gif = { label: "GIF", run: () => setGifsOpen(true) }
    openMenu.set({ x: at.left, y: at.top, label: t("chat.composer.add.to.message"), groups: [gifsReady ? [image, gif] : [image]], above: true })
  }

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  useEffect(() => {
    if (replyTo || inThread !== undefined) area.current?.focus()
  }, [replyTo, excerpt, inThread])

  useLayoutEffect(() => {
    const el = box.current
    const host = el?.parentElement
    if (!el || !host) return
    const main = inThread === undefined && where.kind !== "task"
    const measure = () => {
      host.style.setProperty("--compose-h", `${el.offsetHeight}px`)
      if (!main) return
      const at = el.getBoundingClientRect()
      document.documentElement.style.setProperty("--compose-lift", `${Math.max(0, Math.round(window.innerHeight - at.top))}px`)
      document.documentElement.style.setProperty("--compose-left", `${Math.round(at.left)}px`)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    if (main) watch.observe(host)
    return () => {
      watch.disconnect()
      host.style.removeProperty("--compose-h")
      if (!main) return
      document.documentElement.style.removeProperty("--compose-lift")
      document.documentElement.style.removeProperty("--compose-left")
    }
  }, [inThread, where.kind])

  const commands = useCommands(channel, inThread !== undefined)
  const listed = s.quiet ? [] : matchCommands(commands, text)
  const running = files.length ? null : parseCommand(commands, text)
  const options = s.count || listed.length

  function update(value: string, at = value.length) {
    setText(value)
    s.moved(at)
    drafts.set(key, value)
  }
  const [edit, setEdit] = useState<Edit | null>(null)
  const { attach, paste, reading, dropping, dropZone } = useAttach({
    files,
    setFiles,
    zone: form,
    toast,
    anyFile: !!doc,
    refused: () => (edit ? t("chat.composer.edit.text.only") : null),
  })
  const queued = useRef<string | null>(null)
  const at = useContext(EditHere)
  const editingSeq = useEditingIn(channel.code, at)
  const found = editingSeq === null ? undefined : channel.messages.find((m) => m.seq === editingSeq)
  const editing = found?.partial ? undefined : found
  const partialSeq = found?.partial ? found.seq : null
  const { holdEarlier, earlierTo } = actions
  useEffect(() => {
    if (partialSeq === null) return
    let live = true
    holdEarlier(channel.code, "edit", partialSeq)
    void earlierTo(channel.code, partialSeq).then((ok) => {
      if (!live || ok) return
      toast(t("chat.composer.edit.not.loaded"), "error")
      stopEditing()
    })
    return () => {
      live = false
    }
  }, [channel.code, partialSeq, holdEarlier, earlierTo, toast])
  useEffect(() => {
    if (editingSeq === null) holdEarlier(channel.code, "edit", null)
  }, [channel.code, editingSeq, holdEarlier])
  const [editSeen, setEditSeen] = useState<number | undefined>(undefined)
  if (editing?.seq !== editSeen) {
    setEditSeen(editing?.seq)
    const next = nextEdit(edit, editing, text)
    if (next) {
      setEdit(next.edit)
      update(next.text)
    }
  }
  const editOpen = useRef<Edit | null>(null)
  useEffect(() => {
    editOpen.current = edit
    if (edit) area.current?.focus()
  }, [edit])
  useEffect(
    () => () => {
      const open = editOpen.current
      if (!open) return
      drafts.set(key, open.was)
      stopEditing()
    },
    [key]
  )
  const send = (value = text) => {
    if (edit) {
      const next = value.trim()
      if (next && (!editing || next !== wordsRaw(editing.text).trim())) actions.editMessage(channel.code, edit.seq, next)
      return stopEditing()
    }
    if (running && value === text) {
      running.command.run(running.args)
      setCue(null)
      update("")
      return
    }
    if (reading > 0) {
      queued.current = value
      return
    }
    const body = value.trim()
    if (!body && !files.length) return
    const said = s.sent(body)
    const sent = excerpt ? withExcerpt(excerpt, said) : said
    const long = tooLong(sent)
    if (long) {
      toast(long, "error")
      return
    }
    const say = doc ? sayerAt(`${channel.code}\n${doc}`) : null
    const opts = {
      ...(inThread !== undefined ? { inThread, ...(alsoRoom ? {} : { side: true as const }) } : {}),
      ...(replyTo ? { replyTo: replyTo.seq } : {}),
      ...(files.length ? { images: files } : {}),
    }
    const back = (t: string, f: readonly Upload[]) => giveBack(key, t, f, stashText) === "stash" && setCue({ key, back: false, left: 0, lost: f.length })
    if (!say?.(said, replyTo ? { re: replyTo.seq, quote: excerpt } : null, back, files)) actions.send(channel.code, where, sent, Object.keys(opts).length ? opts : undefined)
    s.forget()
    replying?.set(null)
    setAlsoRoom(false)
    setFiles([])
    setCue(null)
    update("")
  }
  const sendQueued = useEffectEvent(() => {
    const value = queued.current
    queued.current = null
    if (value !== null) send(value)
  })
  useEffect(() => {
    if (!reading) sendQueued()
  }, [reading])
  const ready = !!text.trim() || files.length > 0

  const putAway = () => {
    if (!text.trim()) return
    stash.add(text)
    update("")
    setCue({ key, back: false, left: stash.list.length + 1 })
  }
  const bringBack = (i: number) => {
    const got = stash.take(i, text.trim() ? text : undefined)
    if (!got) return
    setListOf(null)
    setCue({ key, back: true, left: stash.list.length - (text.trim() ? 0 : 1) })
    update(got.text)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(got.text.length, got.text.length)
    })
  }

  const quoteLine = useMemo(() => (excerpt ? excerpt.replace(/\s+/g, " ") : replyTo ? withNames(wordsRaw(replyTo.text), channel.nicknames, preview) : ""), [excerpt, replyTo, channel.nicknames])

  return (
    <div className="compose" ref={box}>
      {listed.length > 0 && (
        <ul className="mentions" role="listbox" aria-label={t("chat.composer.commands")} id={`${key}-commands`}>
          {listed.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === s.pick}>
              <button type="button" tabIndex={-1} className={cx("mention-row task-row", i === s.pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => s.insert(`/${c.name} `)}>
                <span className="command-name">/{c.name}</span>
                {c.args && <span className="task-row-id">{c.args}</span>}
                <span className="task-row-title dim">{c.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Suggestions channel={channel} s={s} />
      <form
        ref={form}
        className={cx("composer", replyTo && "is-replying", dropping && "is-dropping")}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        {...dropZone}
      >
        {stash.list.length > 0 && (
          <div
            className="stash"
            onBlur={(e) => {
              if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
              setListOf(null)
            }}
          >
            {listOpen && (
              <Suspense fallback={null}>
                <StashList
                  list={stash.list}
                  onTake={bringBack}
                  onDrop={stash.drop}
                  onClose={() => {
                    setListOf(null)
                    area.current?.focus()
                  }}
                />
              </Suspense>
            )}
            <button
              type="button"
              className={cx("stash-chip", listOpen && "is-open")}
              aria-expanded={listOpen}
              title={t("chat.composer.stashed.title")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setListOf(listOpen ? null : key)}
            >
              <Icon name="tray" size={14} />
              <span>{tr("chat.composer.stashed.count", { n: <b>{stash.list.length}</b> })}</span>
            </button>
          </div>
        )}
        {dropping && <DropHint />}
        <AttachedFiles files={files} onRemove={(i) => setFiles((now) => now.filter((_, j) => j !== i))} />
        {replyTo && (
          <div className={cx("compose-reply", excerpt && "is-excerpt")}>
            <Icon name="reply" size={13} />
            <span className="compose-reply-text">
              {tr(excerpt ? "chat.composer.quoting" : "chat.composer.replying.to", { name: <b>{nickname(channel, replyTo.from)}</b> })}{" "}
              <span className={excerpt ? "compose-reply-excerpt" : "dim"}>{excerpt ? `“${quoteLine.slice(0, 160)}${quoteLine.length > 160 ? "…" : ""}”` : quoteLine.slice(0, 160)}</span>
            </span>
            <button type="button" className="compose-reply-x" aria-label={t("chat.composer.cancel.reply")} title={t("chat.composer.cancel.reply.esc")} onClick={() => replying?.set(null)}>
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <div className="composer-row">
          <button
            ref={plus}
            type="button"
            className="compose-attach"
            aria-label={t("chat.composer.add.image.gif")}
            title={t("chat.composer.add.image.gif")}
            aria-haspopup="menu"
            data-gif-toggle
            disabled={!!edit}
            onClick={addMenu}
          >
            <Icon name="plus" />
          </button>
          <Suspense fallback={null}>
            <Gifs open={gifsOpen} onReady={setGifsReady} onClose={closeGifs} onFile={(file) => (file ? attach([file]) : toast(t("chat.composer.gif.failed"), "error"))} />
          </Suspense>
          <input
            ref={picker}
            type="file"
            accept={doc ? undefined : [...IMAGE_TYPES].join(",")}
            multiple
            hidden
            onChange={(e) => {
              attach([...(e.target.files ?? [])])
              e.target.value = ""
            }}
          />
          <textarea
            ref={area}
            rows={1}
            value={text}
            aria-label={t("chat.composer.message")}
            aria-autocomplete="list"
            aria-expanded={options > 0}
            aria-controls={listId(s) ?? (listed.length > 0 ? `${key}-commands` : undefined)}
            placeholder={excerpt ? t("chat.composer.say.about.it") : replyTo ? t("chat.composer.reply.to", { name: nickname(channel, replyTo.from) }) : placeholder}
            onChange={(e) => {
              setCue(null)
              update(e.target.value, e.target.selectionStart)
            }}
            onSelect={(e) => s.moved(e.currentTarget.selectionStart)}
            onPaste={paste}
            onKeyDown={(e) => {
              if (composing(e)) return
              if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
                e.preventDefault()
                if (e.shiftKey) bringBack(0)
                else putAway()
                return
              }
              if (e.key === "ArrowUp" && !options && !text && !files.length && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
                const last = lastOwn(channel.messages, where, inThread)
                if (last) {
                  e.preventDefault()
                  startEditing(channel.code, last.seq, at)
                  return
                }
              }
              if (options && e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
                e.preventDefault()
                send()
                return
              }
              const enter = e.key === "Enter"
              if (
                s.keys(e, {
                  count: listed.length,
                  choose: (i) => {
                    const c = listed[i]
                    if (c && enter && running?.command === c) send()
                    else if (c) s.insert(`/${c.name} `)
                  },
                })
              )
                return
              if (e.key === "Escape" && edit) {
                e.preventDefault()
                e.stopPropagation()
                stopEditing()
                return
              }
              if (e.key === "Escape" && replyTo) {
                e.preventDefault()
                e.stopPropagation()
                replying?.set(null)
                return
              }
              if (sendsOn(e, enterSends)) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button type="submit" className={cx("send", ready && "is-ready")} aria-label={edit ? t("chat.composer.save") : t("chat.composer.send")} title={sendTitle(enterSends)} disabled={!ready}>
            <Icon name="send" />
          </button>
        </div>
        {inThread !== undefined && (
          <label className="compose-also">
            <input type="checkbox" checked={alsoRoom} onChange={(e) => setAlsoRoom(e.target.checked)} />
            {t("chat.composer.also.send.to", { place: placeOf(channel, where) })}
          </label>
        )}
      </form>
      {edit && (
        <p className="compose-hint" role="status">
          <b>{t("chat.composer.editing")}</b> <span>·</span> {tr("chat.composer.key.cancels", { key: <kbd>Esc</kbd> })}
        </p>
      )}
      {running && !cue && !edit && (
        <p className="compose-hint" role="status">
          <b>/{running.command.name}</b> <span>·</span> {running.command.summary} <span>·</span> {tr("chat.composer.key.runs.it", { key: <kbd>{enterSends ? "↩" : "⌘↩"}</kbd> })}
          {running.command.args && !running.args ? ` · ${running.command.args}` : ""}
        </p>
      )}
      {cue && (
        <p className="compose-hint" role="status">
          <b>{cue.back ? t("chat.composer.back.from.stash") : t("chat.composer.stashed")}</b> <span>·</span>{" "}
          {cue.back ? (
            t("chat.composer.left", { count: cue.left })
          ) : (
            <>
              {tr("chat.composer.key.brings.back", { key: <kbd>⇧⌘S</kbd> })}
              {cue.lost ? ` · ${cue.lost === 1 ? t("chat.composer.lost.file") : t("chat.composer.lost.files", { count: cue.lost })}` : ""}
            </>
          )}
        </p>
      )}
    </div>
  )
}
