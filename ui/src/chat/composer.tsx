import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { MAX_IMAGE_BYTES, RASTER_MIMES } from "@kiwi/core/protocol.ts"
import { fileDrag, takeDropped } from "@kiwi/app/dropped.ts"
import { takePasted } from "@kiwi/app/pasted.ts"
import { matchCommands, parseCommand, type Command } from "~/chat/commands"
import { preview, useReplying } from "~/chat/reply"
import { STASH_SHOT, useStash, type Stashed } from "~/chat/stash"
import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel, Task, Upload, Where } from "~/model"
import { useApp } from "~/nav"
import { nickname, shown } from "~/names"
import { mentionNames, withNames, type Picks } from "~/chat/linked"

const Gifs = lazy(() => import("~/chat/gif-picker"))

const MENTION = /(^|\s)@([\p{L}\p{N}_.-]*)$/u
const TASK_REF = /(^|\s)#([^#\n]{0,40})$/u

function taskMatches(tasks: readonly Task[], query: string): Task[] {
  const q = query.trim().toLowerCase()
  const id = q.replace(/^t/, "")
  const score = (t: Task): number => {
    if (!q) return 0
    if (/^\d+$/.test(id) && String(t.id).startsWith(id)) return 0
    const title = t.title.toLowerCase()
    if (title.startsWith(q)) return 1
    if (title.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 2
    return title.includes(q) ? 3 : -1
  }
  return tasks
    .filter((t) => !t.archived)
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || Number(a.t.status === "done") - Number(b.t.status === "done") || b.t.updatedAt - a.t.updatedAt)
    .slice(0, 6)
    .map((x) => x.t)
}

const drafts = new Map<string, string>()
const attached = new Map<string, Upload[]>()
const picked = new Map<string, Picks>()
function picksFor(key: string): Picks {
  const have = picked.get(key)
  if (have) return have
  const made: Picks = new Map()
  picked.set(key, made)
  return made
}

type Cue = { key: string; back: boolean; left: number }

function placeOf(channel: Channel, where: Where, inThread?: number): string {
  if (inThread !== undefined) return "this thread"
  if (where.kind === "room") return `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}`
  if (where.kind === "task") return `T${where.task}`
  if (where.kind === "dm") return `your chat with ${nickname(channel, where.with)}`
  return "here"
}

function StashList({ list, place, onTake, onDrop, onClose }: { list: readonly Stashed[]; place: string; onTake: (i: number) => void; onDrop: (i: number) => void; onClose: () => void }) {
  const [on, setOn] = useState(0)
  const rows = useRef<HTMLUListElement>(null)
  useEffect(() => {
    rows.current?.querySelectorAll<HTMLButtonElement>(".stash-row")[Math.min(on, list.length - 1)]?.focus()
  }, [on, list.length])
  return (
    <div
      className="stash-list"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          setOn((on + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length)
        } else if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault()
          onDrop(Math.min(on, list.length - 1))
          setOn(Math.max(0, Math.min(on, list.length - 2)))
          if (list.length === 1) onClose()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="stash-head">
        <span>Stashed in {place}</span>
        <span>{list.length}</span>
      </div>
      <ul ref={rows} aria-label="Stashed drafts">
        {list.map((s, i) => (
          <li key={`${s.at}-${i}`}>
            <button type="button" className="stash-row" onFocus={() => setOn(i)} onMouseEnter={() => setOn(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onTake(i)}>
              <span className="stash-text">{s.text}</span>
              {i === 0 ? <kbd>⇧⌘S</kbd> : <span className="stash-age">{ago(s.at)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="stash-foot">
        Click to bring back · <kbd>⌫</kbd> drops one · <kbd>⇧⌘S</kbd> brings back the newest
      </p>
    </div>
  )
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

type ComposerProps = { channel: Channel; where: Where; placeholder: string; inThread?: number }

export function Composer(props: ComposerProps) {
  return <ComposerIn key={`${props.channel.code}:${JSON.stringify(props.where)}:${props.inThread ?? ""}`} {...props} />
}

function ComposerIn({ channel, where, placeholder, inThread }: ComposerProps) {
  const { app, go, toast } = useApp()
  const replying = useReplying()
  const replyTo = replying?.to ?? null
  const key = `${channel.code}:${JSON.stringify(where)}:${inThread ?? ""}`
  const [text, setText] = useState(() => drafts.get(key) ?? "")
  const [caret, setCaret] = useState(text.length)
  const [pick, setPick] = useState(0)
  const [closed, setClosed] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [files, setFilesNow] = useState<Upload[]>(() => attached.get(key) ?? [])
  const setFiles = (next: Upload[] | ((now: Upload[]) => Upload[])) =>
    setFilesNow((now) => {
      const list = typeof next === "function" ? next(now) : next
      if (list.length) attached.set(key, list)
      else attached.delete(key)
      return list
    })
  const [dropping, setDropping] = useState(false)
  const enterSends = app.prefs.enterSends
  const stash = useStash(key)
  const [cueOf, setCue] = useState<Cue | null>(() => (STASH_SHOT === "stash" ? { key, back: false, left: stash.list.length } : null))
  const cue = cueOf?.key === key ? cueOf : null
  const [listOf, setListOf] = useState<string | null>(() => (STASH_SHOT === "stash-open" ? key : null))
  const listOpen = listOf === key && stash.list.length > 0

  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer && fileDrag(e.dataTransfer)) e.preventDefault()
    }
    window.addEventListener("dragover", block)
    window.addEventListener("drop", block)
    return () => {
      window.removeEventListener("dragover", block)
      window.removeEventListener("drop", block)
    }
  }, [])

  const add = (upload: Upload) => setFiles((now) => (now.length < MAX_FILES ? [...now, upload] : now))
  const attach = (list: readonly File[]) => {
    const room = MAX_FILES - files.length
    if (list.length > room) toast(`Up to ${MAX_FILES} images in one message`)
    for (const f of list.slice(0, Math.max(0, room))) {
      const name = imageName(f)
      if (!IMAGE_TYPES.has(f.type)) {
        toast(`${name} isn't a PNG, JPEG, GIF or WebP`)
        continue
      }
      if (f.size > MAX_IMAGE_BYTES) {
        void import("@kiwi/app/compress-image.ts").then(({ compressImage, renamed }) =>
          compressImage(f, MAX_IMAGE_BYTES).then((done) => (done ? add({ ...done, name: renamed(name, done.mime) }) : toast(`${name} couldn't be read`)))
        )
        continue
      }
      void readBase64(f).then(
        (data) => add({ name, mime: f.type, data }),
        () => toast(`${name} couldn't be read`)
      )
    }
  }

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  useEffect(() => {
    if (replyTo) area.current?.focus()
  }, [replyTo])

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

  const typed = text.slice(0, caret)
  const query = closed ? undefined : MENTION.exec(typed)?.[2]
  const taskQuery = closed || query !== undefined ? undefined : TASK_REF.exec(typed)?.[2]
  const matches =
    query === undefined
      ? []
      : channel.people
          .filter((p) => !p.you && (p.name.toLowerCase().startsWith(query.toLowerCase()) || p.display?.toLowerCase().startsWith(query.toLowerCase())))
          .sort((a, b) => Number(b.presence === "online") - Number(a.presence === "online"))
          .slice(0, 6)
  const taskOptions = taskQuery === undefined ? [] : taskMatches(channel.tasks, taskQuery)
  const commands = useMemo<Command[]>(() => {
    if (inThread !== undefined) return []
    const code = channel.code
    const owner = channel.youOwn
    return [
      { name: "compact", summary: "Ask the lead for a summary to fold the history behind", run: () => app.actions.askCompact(code) },
      { name: "tasks", summary: "Open the tasks", run: () => go({ to: "tab", tab: "tasks" }) },
      ...(owner && !channel.hold ? [{ name: "pause", summary: "Pause the agents", args: "note", run: (note: string) => app.actions.setHold(code, true, note || undefined) }] : []),
      ...(owner && channel.hold ? [{ name: "resume", summary: "Let the agents work again", run: () => app.actions.setHold(code, false) }] : []),
    ]
  }, [inThread, channel.code, channel.youOwn, channel.hold, app.actions, go])
  const listed = closed || query !== undefined || taskQuery !== undefined ? [] : matchCommands(commands, text)
  const running = files.length ? null : parseCommand(commands, text)
  const options = matches.length || taskOptions.length || listed.length
  const mentions = useMemo(() => mentionNames(channel.people, channel.former), [channel.people, channel.former])

  const update = (value: string, at = value.length) => {
    setText(value)
    setCaret(at)
    setPick(0)
    setClosed(false)
    drafts.set(key, value)
  }
  const send = (value = text) => {
    if (running && value === text) {
      running.command.run(running.args)
      setCue(null)
      update("")
      return
    }
    const body = value.trim()
    if (!body && !files.length) return
    const opts = { ...(inThread !== undefined ? { inThread } : {}), ...(replyTo ? { replyTo: replyTo.seq } : {}), ...(files.length ? { images: files } : {}) }
    app.actions.send(channel.code, where, mentions.sent(body, picksFor(key)), Object.keys(opts).length ? opts : undefined)
    picked.delete(key)
    replying?.set(null)
    setFiles([])
    setCue(null)
    update("")
  }
  const ready = !!text.trim() || files.length > 0
  const complete = (name: string) => insert(text.slice(0, caret).replace(MENTION, (_all, pre: string) => `${pre}@${mentions.typed(name, picksFor(key))} `))
  const completeTask = (id: number) => insert(text.slice(0, caret).replace(TASK_REF, (_all, pre: string) => `${pre}T${id} `))
  const insert = (before: string) => {
    const next = before + text.slice(caret)
    update(next, before.length)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }

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

  const quoteLine = useMemo(() => (replyTo ? withNames(replyTo.text, channel.nicknames, preview) : ""), [replyTo, channel.nicknames])

  return (
    <div className="compose" ref={box}>
      {listed.length > 0 && (
        <ul className="mentions" role="listbox" aria-label="Commands" id={`${key}-commands`}>
          {listed.map((c, i) => (
            <li key={c.name} role="option" aria-selected={i === pick}>
              <button type="button" tabIndex={-1} className={cx("mention-row task-row", i === pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(`/${c.name} `)}>
                <span className="command-name">/{c.name}</span>
                {c.args && <span className="task-row-id">{c.args}</span>}
                <span className="task-row-title dim">{c.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {taskOptions.length > 0 && (
        <ul className="mentions" role="listbox" aria-label="Tasks" id={`${key}-tasks`}>
          {taskOptions.map((t, i) => (
            <li key={t.id} role="option" aria-selected={i === pick}>
              <button type="button" tabIndex={-1} className={cx("mention-row task-row", i === pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => completeTask(t.id)}>
                <Dot status={t.status} />
                <span className="task-row-id">T{t.id}</span>
                <span className="task-row-title">{t.title}</span>
                <span className="dim">{t.owner ? nickname(channel, t.owner) : STATUS_WORDS[t.status]}</span>
              </button>
            </li>
          ))}
        </ul>
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
          setDropping(false)
          if (e.dataTransfer.files.length) return attach([...e.dataTransfer.files])
          void takeDropped(e.dataTransfer).then(({ files: dropped, refused }) => {
            for (const why of refused) toast(why)
            attach(dropped)
          })
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
              <StashList
                list={stash.list}
                place={placeOf(channel, where, inThread)}
                onTake={bringBack}
                onDrop={stash.drop}
                onClose={() => {
                  setListOf(null)
                  area.current?.focus()
                }}
              />
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
                <img src={`data:${f.mime};base64,${f.data}`} alt={f.name} />
                <button type="button" className="compose-file-x" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => setFiles((now) => now.filter((_, j) => j !== i))}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
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
          <button type="button" className="compose-attach" aria-label="Attach images" title="Attach images" onClick={() => picker.current?.click()}>
            <Icon name="plus" />
          </button>
          <Suspense fallback={<span className="compose-attach" />}>
            <Gifs onFile={(file) => (file ? attach([file]) : toast("That GIF couldn't be loaded"))} />
          </Suspense>
          <input
            ref={picker}
            type="file"
            accept={[...IMAGE_TYPES].join(",")}
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
            aria-controls={matches.length > 0 ? `${key}-people` : taskOptions.length > 0 ? `${key}-tasks` : listed.length > 0 ? `${key}-commands` : undefined}
            placeholder={replyTo ? `Reply to ${nickname(channel, replyTo.from)}` : placeholder}
            onChange={(e) => {
              setCue(null)
              update(e.target.value, e.target.selectionStart)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={(e) => {
              const fromItems = [...e.clipboardData.items]
                .filter((item) => item.kind === "file")
                .map((item) => item.getAsFile())
                .filter((file): file is File => !!file)
              const images = (e.clipboardData.files.length ? [...e.clipboardData.files] : fromItems).filter((f) => f.type.startsWith("image/"))
              if (!images.length) return void takePasted(e.clipboardData).then((f) => f && attach([f]))
              if (!e.clipboardData.getData("text/plain")) e.preventDefault()
              attach(images)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
                e.preventDefault()
                if (e.shiftKey) bringBack(0)
                else putAway()
                return
              }
              if (options) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault()
                  setPick((pick + (e.key === "ArrowDown" ? 1 : options - 1)) % options)
                  return
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault()
                  const p = matches[pick]
                  const t = taskOptions[pick]
                  const c = listed[pick]
                  if (p) complete(p.name)
                  else if (t) completeTask(t.id)
                  else if (c && e.key === "Enter" && running?.command === c) send()
                  else if (c) insert(`/${c.name} `)
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
          <button type="submit" className={cx("send", ready && "is-ready")} aria-label="Send" title={enterSends ? "Send (Enter)" : "Send (⌘ Enter)"} disabled={!ready}>
            <Icon name="send" />
          </button>
        </div>
      </form>
      {running && !cue && (
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
            </>
          )}
        </p>
      )}
    </div>
  )
}
