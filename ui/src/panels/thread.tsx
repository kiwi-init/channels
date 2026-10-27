import { useMemo } from "react"

import { Composer } from "~/chat/composer"
import { compactAt, namesOf } from "~/chat/conversation"
import { MessageRow } from "~/chat/message"
import { Empty } from "~/kit/bits"
import type { Channel } from "~/model"
import { PanelHead } from "~/panels/frame"

export function ThreadPanel({ channel, seq }: { channel: Channel; seq: number }) {
  const root = channel.messages.find((m) => m.seq === seq)
  const replies = useMemo(() => channel.messages.filter((m) => m.inThread === seq), [channel.messages, seq])
  const names = useMemo(() => namesOf(channel), [channel])
  if (!root)
    return (
      <>
        <PanelHead title="Thread" />
        <Empty title="This message is gone." />
      </>
    )
  return (
    <>
      <PanelHead title="Thread" sub={`· ${root.from}`} />
      <div className="feed">
        <div className="feed-list">
          <div className="thread-root">
            <MessageRow channel={channel} m={root} compact={false} names={names} inThread />
          </div>
          <p className="thread-count">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </p>
          {replies.map((m, i) => (
            <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(replies, i)} names={names} inThread />
          ))}
        </div>
      </div>
      <Composer channel={channel} where={root.where} inThread={seq} placeholder="Reply in thread" />
    </>
  )
}
