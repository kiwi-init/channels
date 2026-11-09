import { lazy, Suspense, useCallback, useContext, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react"

import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, RASTER_MIMES } from "@kiwi/core/protocol.ts"
import { fileDrag, takeDropped } from "@kiwi/app/dropped.ts"
import { takePasted } from "@kiwi/app/pasted.ts"
import { matchCommands, parseCommand } from "~/chat/commands"
import { useCommands } from "~/chat/use-commands"
import { EditHere, startEditing, stopEditing, useEditingIn } from "~/chat/editing"
import { lastOwn, nextEdit, type Edit } from "~/chat/compose-edit"
import { withExcerpt } from "~/chat/quote"
import { sayerAt } from "~/chat/doc/sayer"
import { preview, useReplying } from "~/chat/reply"
import { attached, composerKey, drafts, giveBack, tooLong, useGivenBack } from "~/chat/drafts"
import { composing, sendsOn, sendTitle } from "~/chat/send-keys"
import { STASH_SHOT, stashText, useStash } from "~/chat/stash"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { openMenu } from "~/kit/menu-open"
import type { Channel, Upload, Where } from "~/model"
import { useApp } from "~/nav"
import { nickname } from "~/names"
import { withNames } from "~/chat/linked"
import { listId, Suggestions, useSuggest } from "~/chat/suggest"
import { wordsRaw } from "~/words"

const Gifs = lazy(() => import("~/chat/gif-picker"))
const StashList = lazy(() => import("~/chat/stash-list"))

type Cue = { key: string; back: boolean; left: number; lost?: number }

function placeOf(channel: Channel, where: Where, inThread?: number): string {
  if (inThread !== undefined) return "this thread"
  if (where.kind === "room") return `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}`
  if (where.kind === "task") return `T${where.task}`
  if (where.kind === "dm") return `your chat with ${nickname(channel, where.with)}`
  return "here"
}

const MAX_FILES = 8
const IMAGE_TYPES = new Set<string>(RASTER_MIMES)

function imageName(file: File): string {
  if (file.name) return file.name
  const ext = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] ?? "png")
  return `pasted.${ext}`
}

const readBase64 = (file: File): Promise<string> =>
  new Promise((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      done(url.slice(url.indexOf(",") + 1))
    }
    reader.onerror = () => fail(reader.error ?? new Error("the image couldn't be read"))
    reader.readAsDataURL(file)
  })

type ComposerProps = { channel: Channel; where: Where; placeholder: string; inThread?: number; doc?: string | null }

export function Composer(props: ComposerProps) {
  return <ComposerIn key={composerKey(props.channel.code, props.where, props.inThread)} {...props} />
}

function ComposerIn({ channel, where, placeholder, inThread, doc }: ComposerProps) {
  const { app, toast } = useApp()
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
  const [dropping, setDropping] = useState(false)
  const [alsoRoom, setAlsoRoom] = useState(false)
  const enterSends = app.prefs.enterSends
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
    const image = { label: "Image", run: () => picker.current?.click() }
    const gif = { label: "GIF", run: () => setGifsOpen(true) }
    openMenu.set({ x: at.left, y: at.top, label: "Add to the message", groups: [gifsReady ? [image, gif] : [image]], above: true })
  }

  const add = (upload: Upload) => setFiles((now) => (now.length < MAX_FILES ? [...now, upload] : now))
  const [reading, setReading] = useState(0)
  const queued = useRef<string | null>(null)
  const track = (job: Promise<unknown>): void => {
    setReading((n) => n + 1)
    void job.finally(() => setReading((n) => n - 1))
  }
  const attach = (list: readonly File[]) => {
    if (edit) return void toast("An edit changes only the text. Send the image in a new message.", "error")
    const room = MAX_FILES - files.length
    if (list.length > room) toast(`Up to ${MAX_FILES} images in one message`)
    for (const f of list.slice(0, Math.max(0, room))) {
      const name = imageName(f)
      const image = IMAGE_TYPES.has(f.type)
      if (!image && !doc) {
        toast(`${name} isn't a PNG, JPEG, GIF or WebP`, "error")
        continue
      }
      if (!image && (!f.size || f.size > MAX_FILE_BYTES)) {
        toast(`${name} is empty or too big to send`, "error")
        continue
      }
      if (image && f.size > MAX_IMAGE_BYTES) {
        track(
          import("@kiwi/app/compress-image.ts").then(({ compressImage, renamed }) =>
            compressImage(f, MAX_IMAGE_BYTES).then((done) => (done ? add({ ...done, name: renamed(name, done.mime) }) : toast(`${name} couldn't be read`, "error")))
          )
        )
        continue
      }
      track(
        readBase64(f).then(
          (data) => add({ name, mime: f.type || "application/octet-stream", data }),
          () => toast(`${name} couldn't be read`, "error")
        )
      )
    }
  }

  const takeIn = (dt: DataTransfer) => {
    setDropping(false)
    if (dt.files.length) return attach([...dt.files])
    void takeDropped(dt).then(({ files: dropped, refused }) => {
      for (const why of refused) toast(why, "error")
      attach(dropped)
    })
  }

  const droppedOver = useEffectEvent((e: DragEvent, dt: DataTransfer) => {
    const el = form.current
    if (!el || (e.target instanceof Node && el.contains(e.target))) return
    const r = el.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) takeIn(dt)
  })

  useEffect(() => {
    const block = (e: DragEvent) => {
      if (!e.dataTransfer || !fileDrag(e.dataTransfer)) return
      e.preventDefault()
      if (e.type === "drop") droppedOver(e, e.dataTransfer)
    }
    window.addEventListener("dragover", block)
    window.addEventListener("drop", block)
    return () => {
      window.removeEventListener("dragover", block)
      window.removeEventListener("drop", block)
    }
  }, [])

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
    const measure = () => host.style.setProperty("--compose-h", `${el.offsetHeight}px`)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => {
      watch.disconnect()
      host.style.removeProperty("--compose-h")
    }
  }, [])

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
  const at = useContext(EditHere)
  const editingSeq = useEditingIn(channel.code, at)
  const found = editingSeq === null ? undefined : channel.messages.find((m) => m.seq === editingSeq)
  const editing = found?.partial ? undefined : found
  const partialSeq = found?.partial ? found.seq : null
  const { holdEarlier, earlierTo } = app.actions
  useEffect(() => {
    if (partialSeq === null) return
    let live = true
    holdEarlier(channel.code, "edit", partialSeq)
    void earlierTo(channel.code, partialSeq).then((ok) => {
      if (!live || ok) return
      toast("The whole message couldn't be loaded, so it can't be edited right now", "error")
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
      if (next && (!editing || next !== wordsRaw(editing.text).trim())) app.actions.editMessage(channel.code, edit.seq, next)
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
    if (!say?.(said, replyTo ? { re: replyTo.seq, quote: excerpt } : null, back, files)) app.actions.send(channel.code, where, sent, Object.keys(opts).length ? opts : undefined)
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
        <ul className="mentions" role="listbox" aria-label="Commands" id={`${key}-commands`}>
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
        onDragOver={(e) => {
          if (!fileDrag(e.dataTransfer)) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
          setDropping(false)
        }}
        onDrop={(e) => {
          if (!fileDrag(e.dataTransfer)) return
          e.preventDefault()
          takeIn(e.dataTransfer)
        }}
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
              title="Stashed drafts (⇧⌘S brings back the newest)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setListOf(listOpen ? null : key)}
            >
              <Icon name="tray" size={14} />
              <span>
                <b>{stash.list.length}</b> stashed
              </span>
            </button>
          </div>
        )}
        {dropping && (
          <div className="compose-drop" aria-hidden="true">
            Drop images to attach
          </div>
        )}
        {files.length > 0 && (
          <ul className="compose-files" aria-label="Attached images">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="compose-file">
                {f.mime.startsWith("image/") ? <img src={`data:${f.mime};base64,${f.data}`} alt={f.name} /> : <span className="compose-file-name">{f.name}</span>}
                <button type="button" className="compose-file-x" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => setFiles((now) => now.filter((_, j) => j !== i))}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {replyTo && (
          <div className={cx("compose-reply", excerpt && "is-excerpt")}>
            <Icon name="reply" size={13} />
            <span className="compose-reply-text">
              {excerpt ? "Quoting" : "Replying to"} <b>{nickname(channel, replyTo.from)}</b>{" "}
              <span className={excerpt ? "compose-reply-excerpt" : "dim"}>{excerpt ? `“${quoteLine.slice(0, 160)}${quoteLine.length > 160 ? "…" : ""}”` : quoteLine.slice(0, 160)}</span>
            </span>
            <button type="button" className="compose-reply-x" aria-label="Cancel reply" title="Cancel reply (Esc)" onClick={() => replying?.set(null)}>
              <Icon name="close" size={13} />
            </button>
          </div>
        )}
        <div className="composer-row">
          <button
            ref={plus}
            type="button"
            className="compose-attach"
            aria-label="Add an image or a GIF"
            title="Add an image or a GIF"
            aria-haspopup="menu"
            data-gif-toggle
            disabled={!!edit}
            onClick={addMenu}
          >
            <Icon name="plus" />
          </button>
          <Suspense fallback={null}>
            <Gifs open={gifsOpen} onReady={setGifsReady} onClose={closeGifs} onFile={(file) => (file ? attach([file]) : toast("That GIF couldn't be loaded", "error"))} />
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
            aria-label="Message"
            aria-autocomplete="list"
            aria-expanded={options > 0}
            aria-controls={listId(s) ?? (listed.length > 0 ? `${key}-commands` : undefined)}
            placeholder={excerpt ? "Say something about it" : replyTo ? `Reply to ${nickname(channel, replyTo.from)}` : placeholder}
            onChange={(e) => {
              setCue(null)
              update(e.target.value, e.target.selectionStart)
            }}
            onSelect={(e) => s.moved(e.currentTarget.selectionStart)}
            onPaste={(e) => {
              const fromItems = [...e.clipboardData.items]
                .filter((item) => item.kind === "file")
                .map((item) => item.getAsFile())
                .filter((file): file is File => !!file)
              const images = (e.clipboardData.files.length ? [...e.clipboardData.files] : fromItems).filter((f) => doc || f.type.startsWith("image/"))
              if (!images.length) return track(takePasted(e.clipboardData).then((f) => f && attach([f])))
              if (!e.clipboardData.getData("text/plain")) e.preventDefault()
              attach(images)
            }}
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
          <button type="submit" className={cx("send", ready && "is-ready")} aria-label={edit ? "Save" : "Send"} title={sendTitle(enterSends)} disabled={!ready}>
            <Icon name="send" />
          </button>
        </div>
        {inThread !== undefined && (
          <label className="compose-also">
            <input type="checkbox" checked={alsoRoom} onChange={(e) => setAlsoRoom(e.target.checked)} />
            Also send to {placeOf(channel, where)}
          </label>
        )}
      </form>
      {edit && (
        <p className="compose-hint" role="status">
          <b>Editing</b> <span>·</span> <kbd>Esc</kbd> cancels
        </p>
      )}
      {running && !cue && !edit && (
        <p className="compose-hint" role="status">
          <b>/{running.command.name}</b> <span>·</span> {running.command.summary} <span>·</span> <kbd>{enterSends ? "↩" : "⌘↩"}</kbd> runs it
          {running.command.args && !running.args ? ` · ${running.command.args}` : ""}
        </p>
      )}
      {cue && (
        <p className="compose-hint" role="status">
          <b>{cue.back ? "Back from the stash" : "Stashed"}</b> <span>·</span>{" "}
          {cue.back ? (
            `${cue.left} left`
          ) : (
            <>
              <kbd>⇧⌘S</kbd> brings it back
              {cue.lost ? ` · ${cue.lost === 1 ? "its file" : `its ${cue.lost} files`} didn't fit in the stash` : ""}
            </>
          )}
        </p>
      )}
    </div>
  )
}
