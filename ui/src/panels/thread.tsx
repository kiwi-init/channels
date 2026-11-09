import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { Composer } from "~/chat/composer"
import { compactAt, quoteOf, ReadOnly, useNames, useTaskIds } from "~/chat/conversation"
import { useStick } from "~/chat/stick"
import { EditHere } from "~/chat/editing"
import { MessageRow } from "~/chat/message"
import { threadReply } from "~/chat/quote"
import { threadRoot } from "~/chat/thread-root"
import { QuotePick } from "~/chat/quote-pick"
import { jumpTo, ReplyContext, type Replying } from "~/chat/reply"
import { t } from "~/i18n/i18n"
import { Empty } from "~/kit/empty"
import type { Channel } from "~/model"
import { nickname } from "~/names"
import { useAct } from "~/nav"
import { PanelHead } from "~/panels/frame"

export function ThreadPanel({ channel, seq: opened, focus: asked }: { channel: Channel; seq: number; focus?: number | undefined }) {
  const { seq, focus } = threadRoot(channel.messages, opened, asked)
  const root = channel.messages.find((m) => m.seq === seq)
  const replies = useMemo(() => channel.messages.filter((m) => m.inThread === seq), [channel.messages, seq])
  const bySeq = useMemo(() => new Map(channel.messages.map((m) => [m.seq, m])), [channel.messages])
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const reply = useSyncExternalStore(threadReply.subscribe, threadReply.get)
  const replying = useMemo((): Replying => {
    const here = reply?.code === channel.code && reply.root === seq ? reply : null
    return {
      to: (here && (here.to === seq ? root : replies.find((m) => m.seq === here.to))) ?? null,
      excerpt: here?.excerpt ?? null,
      set: (to, excerpt) => threadReply.set(to ? { code: channel.code, root: seq, to: to.seq, excerpt: excerpt ?? null } : null),
    }
  }, [reply, channel.code, seq, root, replies])
  const { actions } = useAct()
  const { holdEarlier, earlierTo } = actions
  const code = channel.code
  const early = channel.since !== undefined && seq > 0 && seq < channel.since
  const [tried, setTried] = useState<string | null>(null)
  const loadKey = `${code}:${seq}`
  const waiting = early && tried !== loadKey
  useEffect(() => {
    holdEarlier(code, "thread", seq)
    return () => holdEarlier(code, "thread", null)
  }, [code, seq, holdEarlier])
  useEffect(() => {
    if (!early) return
    let live = true
    void earlierTo(code, seq).then(() => {
      if (live) setTried(loadKey)
    })
    return () => {
      live = false
    }
  }, [early, code, seq, loadKey, earlierTo])
  const { scroller, content, remember, toBottom, unstick } = useStick()
  const last = replies.at(-1)?.seq
  const shown = useRef({ seq, last })
  useLayoutEffect(() => {
    if (waiting) return
    if (focus !== undefined) {
      unstick()
      if (jumpTo(content.current, focus, "instant")) return
    }
    toBottom(false)
  }, [seq, focus, content, toBottom, unstick, waiting])
  useLayoutEffect(() => {
    const was = shown.current
    shown.current = { seq, last }
    if (was.seq !== seq || was.last === last) return
    if (last !== undefined && replies.at(-1)?.from === channel.you) toBottom(false)
  }, [seq, last, replies, channel.you, toBottom])
  const onQuote = useCallback((target: number) => void jumpTo(content.current, target), [content])
  const quote = useCallback((at: number, excerpt: string) => threadReply.set({ code: channel.code, root: seq, to: at, excerpt }), [channel.code, seq])
  const following = channel.threads?.find((th) => th.root === seq)?.following ?? channel.follows?.[seq] ?? (root?.from === channel.you || !!root?.mentionsYou)

  if (waiting)
    return (
      <>
        <PanelHead title={t("panels.thread.title")} />
        <div className="feed" />
      </>
    )
  if (!root)
    return (
      <>
        <PanelHead title={t("panels.thread.title")} />
        <Empty title={t("panels.thread.gone")} />
      </>
    )
  return (
    <ReplyContext.Provider value={replying}>
      <EditHere.Provider value="panel">
        <PanelHead title={t("panels.thread.title")} sub={t("panels.thread.sub", { name: nickname(channel, root.from) })}>
          <button type="button" className="btn is-small is-quiet" aria-pressed={following} onClick={() => actions.followThread(channel.code, seq, !following)}>
            {following ? t("panels.thread.following") : t("panels.thread.follow")}
          </button>
        </PanelHead>
        {root.where.kind !== "theirs" && <QuotePick root={content} onQuote={quote} />}
        <div className="feed" ref={scroller} onScroll={remember}>
          <div className="feed-list" ref={content}>
            <div className="thread-root">
              <MessageRow channel={channel} m={root} compact={false} names={names} tasks={tasks} inThread />
            </div>
            <p className="thread-count">{t("panels.thread.replies", { count: replies.length })}</p>
            {replies.map((m, i) => (
              <MessageRow key={m.seq} channel={channel} m={m} compact={compactAt(replies, i)} names={names} tasks={tasks} inThread quote={quoteOf(replies, i, bySeq, seq)} onQuote={onQuote} />
            ))}
          </div>
        </div>
        {root.where.kind === "theirs" ? (
          <ReadOnly channel={channel} between={root.where.between} />
        ) : (
          <Composer channel={channel} where={root.where} inThread={seq} placeholder={t("panels.thread.placeholder")} />
        )}
      </EditHere.Provider>
    </ReplyContext.Provider>
  )
}
