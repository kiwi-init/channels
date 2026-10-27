import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { MAX_IMAGE_BYTES, RASTER_MIMES } from "@kiwi/core/protocol.ts"
import { fileDrag, takeDropped } from "@/lib/dropped"
import { needsCompressing } from "@/lib/needs-compressing"
import { takePasted } from "@/lib/pasted"
import { preview, useReplying } from "~/chat/reply"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel, Upload, Where } from "~/model"
import { useApp } from "~/nav"

const MENTION = /(^|\s)@([\p{L}\p{N}_.-]*)$/u

const drafts = new Map<string, string>()

const MAX_FILES = 8
const IMAGE_TYPES = new Set<string>(RASTER_MIMES)
const KB = Math.round(MAX_IMAGE_BYTES / 1024)

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

export function Composer({ channel, where, placeholder, inThread }: { channel: Channel; where: Where; placeholder: string; inThread?: number }) {
  const { app, toast } = useApp()
  const replying = useReplying()
  const replyTo = replying?.to ?? null
  const key = `${channel.code}:${JSON.stringify(where)}:${inThread ?? ""}`
  const [text, setText] = useState(() => drafts.get(key) ?? "")
  const [caret, setCaret] = useState(text.length)
  const [pick, setPick] = useState(0)
  const [closed, setClosed] = useState(false)
  const [focused, setFocused] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Upload[]>([])
  const [dropping, setDropping] = useState(false)
  const enterSends = app.prefs.enterSends

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
      if (needsCompressing(f, MAX_IMAGE_BYTES)) {
        void import("@/lib/compress-image").then(({ compressImage, renamed }) =>
          compressImage(f, MAX_IMAGE_BYTES).then((done) => (done ? add({ ...done, name: renamed(name, done.mime) }) : toast(`${name} couldn't be shrunk under ${KB} KB`)))
        )
        continue
      }
      if (f.size > MAX_IMAGE_BYTES) {
        toast(`${name} is over ${KB} KB. Attach a smaller image`)
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
    const body = value.trim() || files.map((f) => f.name).join(", ")
    if (!body) return
    const opts = { ...(inThread !== undefined ? { inThread } : {}), ...(replyTo ? { replyTo: replyTo.seq } : {}), ...(files.length ? { images: files } : {}) }
    app.actions.send(channel.code, where, body, Object.keys(opts).length ? opts : undefined)
    replying?.set(null)
    setFiles([])
    update("")
  }
  const ready = !!text.trim() || files.length > 0
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
      {matches.length > 0 && (
        <ul className="mentions" role="listbox" aria-label="People" id={`${key}-people`}>
          {matches.map((p, i) => (
            <li key={p.name} role="option" aria-selected={i === pick}>
              <button type="button" tabIndex={-1} className={cx("mention-row", i === pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => complete(p.name)}>
                <Avatar person={p} size="sm" pip />
                <span className="mention-name">{p.name}</span>
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
              Replying to <b>{replyTo.from}</b> <span className="dim">{quoteLine.slice(0, 160)}</span>
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
            aria-expanded={matches.length > 0}
            aria-controls={matches.length > 0 ? `${key}-people` : undefined}
            placeholder={replyTo ? `Reply to ${replyTo.from}` : placeholder}
            onChange={(e) => update(e.target.value, e.target.selectionStart)}
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
          <button type="submit" className={cx("send", ready && "is-ready")} aria-label="Send" title={enterSends ? "Send (Enter)" : "Send (⌘ Enter)"} disabled={!ready}>
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
