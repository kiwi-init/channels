import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Composer } from "~/chat/composer"
import { compactAt, namesOf, quoteOf, useStick } from "~/chat/conversation"
import { MessageRow } from "~/chat/message"
import { jumpTo, ReplyContext, type Replying } from "~/chat/reply"
import { Empty } from "~/kit/bits"
import type { Channel, Message } from "~/model"
import { PanelHead } from "~/panels/frame"

export function ThreadPanel({ channel, seq }: { channel: Channel; seq: number }) {
  const root = channel.messages.find((m) => m.seq === seq)
  const replies = useMemo(() => channel.messages.filter((m) => m.inThread === seq), [channel.messages, seq])
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const names = useMemo(() => namesOf(channel), [channel])
  const [reply, setReply] = useState<{ seq: number; to: Message } | null>(null)
  const replying = useMemo((): Replying => ({ to: reply?.seq === seq ? reply.to : null, set: (to) => setReply(to ? { seq, to } : null) }), [reply, seq])
  const scroller = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const { remember, toBottom } = useStick(scroller, content)
  const last = replies.at(-1)?.seq
  useLayoutEffect(() => toBottom(false), [seq, toBottom])
  useLayoutEffect(() => {
    if (last !== undefined && replies.at(-1)?.from === channel.you) toBottom(false)
  }, [last, replies, channel.you, toBottom])
  const onQuote = useCallback((target: number) => void jumpTo(content.current, target), [])

  if (!root)
    return (
      <>
        <PanelHead title="Thread" />
        <Empty title="This message is gone." />
      </>
    )
  return (
    <ReplyContext.Provider value={replying}>
      <PanelHead title="Thread" sub={`· ${root.from}`} />
      <div className="feed" ref={scroller} onScroll={remember}>
        <div className="feed-list" ref={content}>
          <div className="thread-root">
            <MessageRow channel={channel} m={root} compact={false} names={names} inThread />
          </div>
          <p className="thread-count">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </p>
          {replies.map((m, i) => (
            <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(replies, i)} names={names} inThread quote={quoteOf(replies, i, bySeq, seq)} onQuote={onQuote} />
          ))}
        </div>
      </div>
      <Composer channel={channel} where={root.where} inThread={seq} placeholder="Reply in thread" />
    </ReplyContext.Provider>
  )
}
