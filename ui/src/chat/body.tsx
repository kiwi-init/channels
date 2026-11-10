import { lazy, Suspense, useCallback, useMemo, useState } from "react"

import { linked, useMentionParser } from "~/chat/linked"
import { parsedFor } from "~/chat/parsed"
import { useAct, useChannelHere } from "~/nav"
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
}: {
  text: Words
  seq: number
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  onImage: (url: string, alt: string) => void
  onMessage: (seq: number) => void
}) {
  const { go } = useAct()
  const parser = useMentionParser()
  const { markdown } = useMemo(() => ({ parser, markdown: linked(wordsRaw(text), names, tasks, seq) }), [parser, text, names, tasks, seq])
  const [shown, setShown] = useState(false)
  const onShown = useCallback(() => setShown(true), [])
  const open = useChannelHere()
  const onMention = useCallback((name: string) => go(open ? personGo(open, name) : { to: "modal", modal: { kind: "person", name } }), [go, open])
  const onTask = useCallback((task: number) => go({ to: "task", task }), [go])
  return (
    <div className="msg-text">
      {!shown && !parsedFor(markdown) && <p className="md-plain">{wordsPlain(text, names)}</p>}
      <Suspense fallback={null}>
        <Markdown markdown={markdown} onMention={onMention} onTask={onTask} onMessage={onMessage} onImage={onImage} onShown={onShown} />
      </Suspense>
    </div>
  )
}
