import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Composer } from "~/chat/composer"
import { compactAt, quoteOf, ReadOnly, useNames, useStick, useTaskIds } from "~/chat/conversation"
import { MessageRow } from "~/chat/message"
import { jumpTo, ReplyContext, type Replying } from "~/chat/reply"
import { Empty } from "~/kit/bits"
import type { Channel, Message } from "~/model"
import { nickname } from "~/names"
import { PanelHead } from "~/panels/frame"

export function ThreadPanel({ channel, seq, focus }: { channel: Channel; seq: number; focus?: number | undefined }) {
  const root = channel.messages.find((m) => m.seq === seq)
  const replies = useMemo(() => channel.messages.filter((m) => m.inThread === seq), [channel.messages, seq])
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const [reply, setReply] = useState<{ seq: number; to: Message } | null>(null)
  const replying = useMemo((): Replying => ({ to: reply?.seq === seq ? reply.to : null, set: (to) => setReply(to ? { seq, to } : null) }), [reply, seq])
  const { scroller, content, remember, toBottom, unstick } = useStick()
  const last = replies.at(-1)?.seq
  const shown = useRef({ seq, last })
  useLayoutEffect(() => {
    if (focus !== undefined) {
      unstick()
      if (jumpTo(content.current, focus, "instant")) return
    }
    toBottom(false)
  }, [seq, focus, content, toBottom, unstick])
  useLayoutEffect(() => {
    const was = shown.current
    shown.current = { seq, last }
    if (was.seq !== seq || was.last === last) return
    if (last !== undefined && replies.at(-1)?.from === channel.you) toBottom(false)
  }, [seq, last, replies, channel.you, toBottom])
  const onQuote = useCallback((target: number) => void jumpTo(content.current, target), [content])

  if (!root)
    return (
      <>
        <PanelHead title="Thread" />
        <Empty title="This message is gone." />
      </>
    )
  return (
    <ReplyContext.Provider value={replying}>
      <PanelHead title="Thread" sub={`· ${nickname(channel, root.from)}`} />
      <div className="feed" ref={scroller} onScroll={remember}>
        <div className="feed-list" ref={content}>
          <div className="thread-root">
            <MessageRow channel={channel} m={root} compact={false} names={names} tasks={tasks} inThread />
          </div>
          <p className="thread-count">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </p>
          {replies.map((m, i) => (
            <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(replies, i)} names={names} tasks={tasks} inThread quote={quoteOf(replies, i, bySeq, seq)} onQuote={onQuote} />
          ))}
        </div>
      </div>
      {root.where.kind === "theirs" ? <ReadOnly channel={channel} between={root.where.between} /> : <Composer channel={channel} where={root.where} inThread={seq} placeholder="Reply in thread" />}
    </ReplyContext.Provider>
  )
}
