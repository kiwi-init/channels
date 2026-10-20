import { Add01Icon, ArrowUp02Icon, Cancel01Icon, Loading03Icon, Mic01Icon, SmileIcon } from "@hugeicons/core-free-icons"
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type { SendOptions } from "@kiwi/core/client.ts"
import { MAX_IMAGE_BYTES, RASTER_MIMES, type Color, type Message } from "@kiwi/core/protocol.ts"
import { matchCommands, parseCommand, type Command } from "@/lib/commands"
import { answered } from "@/lib/asks"
import { compressImage, needsCompressing, renamed } from "@/lib/compress-image"
import { draftOf, keepDraft, type DraftFile } from "@/lib/drafts"
import { appendDictation, MODEL_MB, PRESS_LABEL, useDictation } from "@/lib/dictation"
import { excerpt } from "@/lib/format"
import { composerMentions, mentionText, withHandles } from "@/lib/mentions"
import { gifFile, type Gif } from "@/lib/gifs"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { CommandBar, CommandList, ComposerQuestion, GifPicker } from "./lazy"
import { Alert, Button, Monogram, errorText, toast } from "./kit"

const MENTION = /(^|\s)@([\p{L}\p{N}_.-]*)$/u
const LEADING = /^(?:\s*@([\p{L}\p{N}_.-]+)[\s,]*)+/u
const IMAGE_TYPES = new Set<string>(RASTER_MIMES)

function imageName(file: File): string {
  if (file.name) return file.name
  const ext = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] ?? "png")
  return `pasted.${ext}`
}

export interface Person {
  name: string
  label: string
  agent: boolean
  color?: Color | null
}

interface Props {
  me: string
  people: Person[]
  replyTo: Message | null
  /** The oldest open decision for you: it sits above the field, can't be dismissed, and what you send answers it. */
  asking?: Message
  /** Typing a slash at the start lists these; one run with its arguments instead of sending a message. */
  commands?: readonly Command[]
  more?: number
  onAnswer?: (m: Message, text: string) => Promise<boolean>
  nameOf: (name: string) => string
  onClearReply: () => void
  disabled: boolean
  send: (body: string, opts: SendOptions) => Promise<number>
  /** In a thread: every message answers replyTo (the root), and there's no reply bar to cancel. */
  thread?: boolean
  /** What every message from here carries, so it lands in this conversation (a task's thread, a direct thread). */
  extra?: Pick<SendOptions, "to" | "task" | "dm">
  /** Placeholder for this conversation ("Message T12", "Message win"). */
  placeholder?: string
  /** Under the field, inside the composer: what the agents are doing (agent-strip.tsx). */
  footer?: ReactNode
  talk?: { button: ReactNode; bar: ReactNode }
  draftKey?: string
}

/** Who a message is for: the people @mentioned at its start. */
function recipients(body: string, names: Set<string>): string[] {
  const lead = LEADING.exec(body)?.[0] ?? ""
  return [...lead.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map((m) => m[1]!).filter((n) => names.has(n))
}

export function Composer({ me, people, replyTo, asking, commands = [], more = 0, onAnswer, nameOf, onClearReply, disabled, send, thread, extra, placeholder, footer, talk, draftKey }: Props) {
  const [body, setBody] = useState(() => draftOf(draftKey)?.body ?? "")
  const [files, setFiles] = useState<DraftFile[]>(() => draftOf(draftKey)?.files ?? [])
  useEffect(() => keepDraft(draftKey, { body, files }), [draftKey, body, files])
  const [dropping, setDropping] = useState(false)
  const [gifsOpen, setGifsOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [mention, setMention] = useState<{
    query: string
    index: number
  } | null>(null)
  const [slash, setSlash] = useState(0)
  const [slashOff, setSlashOff] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  const caretTo = useRef<number | null>(null)
  const dictation = useDictation(
    (text) => setBody((current) => appendDictation(current, text)),
    (message) => toast(message, "error")
  )
  const picker = useRef<HTMLInputElement>(null)

  const others = useMemo(() => people.filter((p) => p.name !== me), [people, me])
  const names = useMemo(() => new Set(others.map((p) => p.name)), [others])
  const matches = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return others.filter((p) => p.name.toLowerCase().startsWith(q) || p.label.toLowerCase().startsWith(q)).slice(0, 6)
  }, [mention, others])
  const spans = useMemo(() => composerMentions(body, others), [body, others])

  // Grow with the text, up to a point.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
    if (caretTo.current !== null) {
      el.setSelectionRange(caretTo.current, caretTo.current)
      caretTo.current = null
    }
    if (backdrop.current) backdrop.current.scrollTop = el.scrollTop
  }, [body])

  useEffect(() => {
    if (replyTo) area.current?.focus()
  }, [replyTo])

  // A drop anywhere else in the window must not navigate the dashboard away.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return
      e.preventDefault()
    }
    window.addEventListener("dragover", block)
    window.addEventListener("drop", block)
    return () => {
      window.removeEventListener("dragover", block)
      window.removeEventListener("drop", block)
    }
  }, [])

  const listed = thread || slashOff ? [] : matchCommands(commands, body)
  const picked = listed.length ? listed[Math.min(slash, listed.length - 1)] : undefined
  const running = thread ? null : parseCommand(commands, body)

  const canSend = !disabled && !sending && (body.trim().length > 0 || files.length > 0)

  const pick = (list: FileList | File[] | null) => {
    if (!list || disabled) return
    for (const f of [...list].slice(0, 8 - files.length)) {
      const name = imageName(f)
      if (!IMAGE_TYPES.has(f.type)) {
        toast(`${name} isn’t a PNG, JPEG, GIF, or WebP.`, "error")
        continue
      }
      if (needsCompressing(f, MAX_IMAGE_BYTES)) {
        void compressImage(f, MAX_IMAGE_BYTES).then((done) => {
          if (!done) return toast(`${name} couldn’t be shrunk under ${Math.round(MAX_IMAGE_BYTES / 1024)} KB.`, "error")
          setFiles((prev) => (prev.length < 8 ? [...prev, { ...done, name: renamed(name, done.mime) }] : prev))
        })
        continue
      }
      if (f.size > MAX_IMAGE_BYTES) {
        toast(`${name} is over ${Math.round(MAX_IMAGE_BYTES / 1024)} KB. Attach a smaller image.`, "error")
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result)
        setFiles((prev) =>
          prev.length < 8
            ? [
                ...prev,
                {
                  name,
                  mime: f.type,
                  data: url.slice(url.indexOf(",") + 1),
                },
              ]
            : prev
        )
      }
      reader.readAsDataURL(f)
    }
  }

  const addGif = (g: Gif) => {
    setGifsOpen(false)
    if (files.length >= 8) return
    void gifFile(g).then(
      (file) => setFiles((prev) => (prev.length < 8 ? [...prev, file] : prev)),
      () => toast("That GIF couldn’t be loaded.", "error")
    )
  }

  const trackMention = (value: string, caret: number) => {
    const m = MENTION.exec(value.slice(0, caret))
    setMention(m ? { query: m[2]!, index: 0 } : null)
  }

  const complete = (p: Person) => {
    const el = area.current
    const caret = el?.selectionStart ?? body.length
    const before = body.slice(0, caret).replace(MENTION, (_all, pre: string) => `${pre}@${mentionText(p, others)} `)
    caretTo.current = before.length
    setBody(before + body.slice(caret))
    setMention(null)
    el?.focus()
  }

  const submit = async () => {
    if (!canSend) return
    if (running) {
      keepDraft(draftKey, { body: "", files })
      setBody("")
      try {
        await running.command.run(running.args)
      } catch (err) {
        toast(`/${running.command.name} failed: ${errorText(err)}`, "error")
      }
      area.current?.focus()
      return
    }
    setSending(true)
    try {
      const text = withHandles(body.trim(), others) || files.map((f) => f.name).join(", ")
      const named = recipients(text, names)
      const answering = answered(asking, named, !!replyTo || !!thread)
      const to = named.length ? named : answering ? [answering.from] : replyTo && replyTo.from !== me ? [replyTo.from] : extra?.to
      await send(text, {
        to,
        // A person's message is just a message: a question needs no menu to be one.
        kind: "msg",
        re: replyTo ? [replyTo.seq] : answering ? [answering.seq] : undefined,
        ...(extra?.task !== undefined ? { task: extra.task } : {}),
        // A direct thread's message is to the other one only: an @ or a reply can't widen it.
        ...(extra?.dm ? { to: extra.to, dm: true } : {}),
        imgs: files.length ? files : undefined,
      })
      if (area.current?.value === body || !area.current) keepDraft(draftKey, { body: "", files: [] })
      setBody((now) => (now === body ? "" : now))
      setFiles([])
      if (!thread) onClearReply()
    } catch (err) {
      toast(`Not sent: ${errorText(err)}`, "error")
    } finally {
      setSending(false)
      area.current?.focus()
    }
  }

  const asked = !thread && !replyTo ? asking : undefined
  const hint = disabled ? "Connecting…" : thread ? "Reply" : replyTo ? `Reply to ${nameOf(replyTo.from)}` : asked ? `Answer ${nameOf(asked.from)}` : (placeholder ?? "Message")

  return (
    <div className={cx("relative mx-auto w-full shrink-0", thread ? "px-3 pt-2 pb-3" : "max-w-[792px] px-3 pt-2 pb-4 md:px-4")}>
      {gifsOpen && <GifPicker onPick={addGif} onClose={() => setGifsOpen(false)} />}
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="hidden" onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />

      {matches.length > 0 && (
        <div className="animate-rise absolute bottom-full left-14 z-20 mb-1 w-64 overflow-hidden rounded-card bg-raised p-1 shadow-pop">
          {matches.map((p, i) => (
            <button
              key={p.name}
              type="button"
              onMouseDown={(e) => (e.preventDefault(), complete(p))}
              className={cx("flex w-full items-center gap-2.5 rounded-row px-2 py-1.5 text-left text-ui", i === mention!.index ? "bg-wash-2" : "hover:bg-wash")}
            >
              <Monogram name={p.label} hue={p.name} agent={p.agent} color={p.color} size={20} />
              <span className="truncate font-medium">{p.label}</span>
              {p.label !== p.name && <span className="truncate text-ink-3">@{p.name}</span>}
            </button>
          ))}
        </div>
      )}

      {asking && !thread && (
        <ComposerQuestion m={asking} more={more} nameOf={nameOf} disabled={disabled} onChoose={(c) => onAnswer?.(asking, c) ?? Promise.resolve(false)} onElse={() => area.current?.focus()} />
      )}

      {listed.length > 0 && picked && <CommandList commands={listed} picked={picked} onPick={(c) => setBody(`/${c.name} `)} />}

      {running && <CommandBar command={running.command} args={running.args} />}

      {talk?.bar}
      {replyTo && !thread && replyTo.seq !== asking?.seq && (
        <div className="mb-1.5 ml-3 flex items-center gap-2 rounded-ctl px-2 text-meta text-ink-2">
          <span className="min-w-0 truncate">
            Replying to <span className="font-medium text-ink">{nameOf(replyTo.from)}</span> <span className="text-ink-3">{excerpt(replyTo.body, 80)}</span>
          </span>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={onClearReply}
            className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-wash-2 hover:text-ink"
          >
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        </div>
      )}

      <div>
        <div
          className={cx(
            "relative min-w-0 overflow-hidden rounded-dock bg-canvas shadow-[inset_0_0_0_1px_var(--edge-strong)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--ring)]",
            dropping && "shadow-[0_0_0_1.5px_var(--ring)]"
          )}
          onDragEnter={(e) => {
            if (disabled || !e.dataTransfer.types.includes("Files")) return
            e.preventDefault()
            setDropping(true)
          }}
          onDragOver={(e) => {
            if (disabled || !e.dataTransfer.types.includes("Files")) return
            e.preventDefault()
            e.dataTransfer.dropEffect = "copy"
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return
            setDropping(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDropping(false)
            pick(e.dataTransfer.files)
          }}
        >
          {dropping && <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-dock bg-canvas/90 text-ui text-ink-2">Drop images</div>}

          {files.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-3 pt-2.5">
              {files.map((f, i) => (
                <span key={i} className="group relative shrink-0">
                  <img src={`data:${f.mime};base64,${f.data}`} alt={f.name} title={f.name} className="size-16 rounded-card object-cover shadow-[0_0_0_0.5px_var(--line)]" />
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-canvas"
                  >
                    <Icon icon={Cancel01Icon} size={11} strokeWidth={2.2} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end">
            <button
              type="button"
              aria-label="Attach images"
              title="Attach images"
              onClick={() => picker.current?.click()}
              disabled={disabled || files.length >= 8}
              className="m-1.5 flex size-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-wash hover:text-ink disabled:opacity-40"
            >
              <Icon icon={Add01Icon} size={17} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="GIFs"
              title="GIFs"
              aria-expanded={gifsOpen}
              onClick={() => setGifsOpen((v) => !v)}
              disabled={disabled || files.length >= 8}
              className="my-1.5 mr-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-pick hover:text-ink disabled:opacity-40"
            >
              <Icon icon={SmileIcon} size={18} strokeWidth={1.8} />
            </button>
            <div className="relative min-w-0 flex-1">
              {spans.length > 0 && (
                <div
                  ref={backdrop}
                  aria-hidden
                  className="bubble-text pointer-events-none absolute inset-0 [scrollbar-color:transparent_transparent] overflow-y-auto py-[13px] pr-1 pl-1 text-body whitespace-pre-wrap text-transparent"
                >
                  {spans.map((s, i) => (
                    <Fragment key={s.at}>
                      {body.slice(i ? spans[i - 1]!.end : 0, s.at)}
                      <mark className="rounded-row bg-accent-wash text-transparent outline-2 outline-accent-wash">{body.slice(s.at, s.end)}</mark>
                    </Fragment>
                  ))}
                  {body.slice(spans.at(-1)!.end)}
                </div>
              )}
              <textarea
                ref={area}
                rows={1}
                value={body}
                disabled={disabled}
                aria-label="Message"
                placeholder={hint}
                onChange={(e) => {
                  setBody(e.target.value)
                  setSlash(0)
                  setSlashOff(false)
                  trackMention(e.target.value, e.target.selectionStart)
                }}
                onScroll={(e) => {
                  if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop
                }}
                onPaste={(e) => {
                  const fromItems = [...e.clipboardData.items]
                    .filter((item) => item.kind === "file")
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => !!file)
                  const images = (e.clipboardData.files.length ? [...e.clipboardData.files] : fromItems).filter((f) => f.type.startsWith("image/"))
                  if (!images.length) return
                  if (!e.clipboardData.getData("text/plain")) e.preventDefault()
                  pick(images)
                }}
                onKeyDown={(e) => {
                  if (matches.length && mention) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault()
                      const d = e.key === "ArrowDown" ? 1 : -1
                      setMention({
                        ...mention,
                        index: (mention.index + d + matches.length) % matches.length,
                      })
                      return
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault()
                      complete(matches[mention.index]!)
                      return
                    }
                    if (e.key === "Escape") {
                      e.stopPropagation()
                      return setMention(null)
                    }
                  }
                  if (picked) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault()
                      setSlash((Math.min(slash, listed.length - 1) + (e.key === "ArrowDown" ? 1 : -1) + listed.length) % listed.length)
                      return
                    }
                    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && body.trim().slice(1).toLowerCase() !== picked.name)) {
                      e.preventDefault()
                      setBody(`/${picked.name} `)
                      return
                    }
                    if (e.key === "Escape") {
                      e.stopPropagation()
                      return setSlashOff(true)
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void submit()
                  }
                  // A thread panel listens for Escape. Swallow it only when it clears a reply in the main composer.
                  if (e.key === "Escape" && replyTo && !thread) {
                    e.stopPropagation()
                    onClearReply()
                  }
                }}
                className="bubble-text relative block max-h-[220px] min-h-[48px] w-full resize-none bg-transparent py-[13px] pr-1 pl-1 text-body outline-none placeholder:truncate placeholder:text-ink-3 focus-visible:outline-none"
              />
            </div>
            {talk?.button}
            {dictation.supported && (
              <button
                type="button"
                aria-label={PRESS_LABEL[dictation.phase]}
                aria-pressed={dictation.phase === "listening"}
                title={dictation.phase === "downloading" ? `${PRESS_LABEL.downloading}, ${Math.round(dictation.progress * 100)}%` : PRESS_LABEL[dictation.phase]}
                onClick={() => void dictation.press()}
                disabled={disabled || dictation.phase === "downloading" || dictation.phase === "transcribing"}
                className={cx(
                  "my-1.5 ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
                  dictation.phase === "listening" ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-wash hover:text-ink"
                )}
              >
                <Icon
                  icon={dictation.phase === "downloading" || dictation.phase === "transcribing" ? Loading03Icon : Mic01Icon}
                  size={17}
                  strokeWidth={2}
                  className={dictation.phase === "downloading" || dictation.phase === "transcribing" ? "animate-spin" : undefined}
                />
              </button>
            )}
            {dictation.phase === "asking" && (
              <Alert
                open
                onClose={dictation.cancel}
                title="Dictate on this computer?"
                message={`Dictation turns your voice into text right here, on this computer. The first time, it downloads a ${MODEL_MB} MB speech model through your relay. After that, your audio never leaves this computer.`}
              >
                <Button variant="secondary" onClick={dictation.cancel}>
                  Not now
                </Button>
                <Button onClick={() => void dictation.confirm()}>Download and dictate</Button>
              </Alert>
            )}
            <button
              type="button"
              aria-label="Send (Return)"
              title="Send (Return)"
              disabled={!canSend}
              onClick={() => void submit()}
              className={cx(
                "m-1.5 flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150",
                canSend ? "bg-accent text-accent-ink hover:opacity-90 active:scale-95" : "text-ink-3 shadow-[inset_0_0_0_1px_var(--line)]"
              )}
            >
              <Icon icon={ArrowUp02Icon} size={18} strokeWidth={2.2} />
            </button>
          </div>
          {footer}
        </div>
      </div>
    </div>
  )
}
