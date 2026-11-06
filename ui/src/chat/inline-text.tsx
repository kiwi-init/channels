import type { MouseEvent, ReactNode } from "react"

import { hitsIn, type Found } from "@kiwi/app/mentions.ts"
import { jumpTo } from "~/chat/reply"
import { OutsideLink } from "~/kit/outside"
import type { Channel } from "~/model"
import { openMessage } from "~/live/open-message"
import { useAct } from "~/nav"

const URL_IN_TEXT = /https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]/g

type Part = { kind: "text"; text: string } | { kind: "url"; url: string } | { kind: "hit"; hit: Found }

function partsOf(text: string, nicknames: ReadonlyMap<string, string>, before: number | undefined): Part[] {
  const parts: Part[] = []
  const plain = (s: string) => {
    let from = 0
    for (const m of s.matchAll(URL_IN_TEXT)) {
      if (m.index > from) parts.push({ kind: "text", text: s.slice(from, m.index) })
      parts.push({ kind: "url", url: m[0] })
      from = m.index + m[0].length
    }
    if (from < s.length) parts.push({ kind: "text", text: s.slice(from) })
  }
  let from = 0
  for (const hit of hitsIn(text, nicknames, before)) {
    plain(text.slice(from, hit.start))
    parts.push({ kind: "hit", hit })
    from = hit.end
  }
  plain(text.slice(from))
  return parts
}

export function linksIn(text: string, nicknames: ReadonlyMap<string, string>, before?: number): Part[] {
  return partsOf(text, nicknames, before).filter((p) => p.kind === "url" || (p.kind === "hit" && (p.hit.kind === "task" || p.hit.kind === "ref" || p.hit.kind === "link")))
}

const showMessage = (code: string, seq: number): void => {
  if (!jumpTo(document.body, seq)) openMessage(code, seq)
}

type Go = ReturnType<typeof useAct>["go"]

export function PartView({ part, channel, go }: { part: Part; channel: Channel; go: Go }): ReactNode {
  const quiet = (run: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    run()
  }
  if (part.kind === "text") return part.text
  if (part.kind === "url")
    return (
      <span className="inline-ref" onClick={(e) => e.stopPropagation()}>
        <OutsideLink href={part.url}>{part.url}</OutsideLink>
      </span>
    )
  const hit = part.hit
  switch (hit.kind) {
    case "task":
      return channel.tasks.some((t) => t.id === hit.id) ? (
        <button type="button" className="inline-ref" title="Open the task" onClick={quiet(() => go({ to: "panel", panel: { kind: "task", task: hit.id } }))}>
          T{hit.id}
        </button>
      ) : (
        `T${hit.id}`
      )
    case "ref":
      return (
        <button type="button" className="inline-ref" title="Show the message" onClick={quiet(() => showMessage(channel.code, hit.seq))}>
          #{hit.seq}
        </button>
      )
    case "link":
      return (
        <button type="button" className="inline-ref" title="Show the message" onClick={quiet(() => (hit.code === channel.code ? showMessage(channel.code, hit.seq) : openMessage(hit.code, hit.seq)))}>
          message #{hit.seq}
        </button>
      )
    case "mention":
      return `@${hit.label}`
    case "bare":
      return hit.label
    case "image":
      return hit.alt
    default: {
      const never: never = hit
      return never
    }
  }
}

export function InlineText({ text, channel, before }: { text: string; channel: Channel; before?: number }) {
  const { go } = useAct()
  return (
    <>
      {partsOf(text, channel.nicknames, before).map((part, i) => (
        <PartView key={i} part={part} channel={channel} go={go} />
      ))}
    </>
  )
}

export function InlineLinks({ text, channel, before }: { text: string; channel: Channel; before?: number }) {
  const { go } = useAct()
  const links = linksIn(text, channel.nicknames, before)
  if (!links.length) return null
  return (
    <span className="ask-option-refs">
      {links.map((part, i) => (
        <PartView key={i} part={part} channel={channel} go={go} />
      ))}
    </span>
  )
}
