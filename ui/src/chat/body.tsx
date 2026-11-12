import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react"

import { useHug } from "~/chat/hug"
import { linked, useMentionParser } from "~/chat/linked"
import { parsedFor } from "~/chat/parsed"
import { useAct } from "~/nav"
import { type Words, wordsPlain, wordsRaw } from "~/words"
import { personGo } from "~/person-go"

const Markdown = lazy(() => import("~/chat/markdown"))

export function Body({
  text,
  seq,
  names,
  tasks,
  onImage,
  onMessage,
  hug = false,
  at,
}: {
  text: Words
  seq: number
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  onImage: (url: string, alt: string) => void
  onMessage: (seq: number) => void
  hug?: boolean
  at?: number
}) {
  const { go, now } = useAct()
  const parser = useMentionParser()
  const { markdown } = useMemo(() => ({ parser, markdown: linked(wordsRaw(text), names, tasks, seq) }), [parser, text, names, tasks, seq])
  const [shown, setShown] = useState(false)
  const onShown = useCallback(() => setShown(true), [])
  const box = useRef<HTMLDivElement>(null)
  useHug(box, hug, shown ? markdown : null)
  const onMention = useCallback(
    (name: string) => {
      const open = now?.().channel ?? null
      go(open ? personGo(open, name) : { to: "modal", modal: { kind: "person", name } })
    },
    [go, now]
  )
  const onTask = useCallback((task: number) => go({ to: "task", task }), [go])
  return (
    <div className="msg-text" ref={box}>
      {!shown && !parsedFor(markdown) && <p className="md-plain">{wordsPlain(text, names)}</p>}
      <Suspense fallback={null}>
        <Markdown markdown={markdown} at={at} onMention={onMention} onTask={onTask} onMessage={onMessage} onImage={onImage} onShown={onShown} />
      </Suspense>
    </div>
  )
}
