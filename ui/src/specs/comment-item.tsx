import "~/i18n/en/specs"
import { Body } from "~/chat/body"
import { t } from "~/i18n/i18n"
import { MessageImages, QUICK, Reacts, Unsent } from "~/chat/message"
import { preview } from "~/chat/preview"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { clock } from "~/kit/time"
import { copyText } from "~/kit/toasts"
import { openMessage } from "~/live/open-message"
import type { Channel } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { faceOf, splitQuote, type Comment } from "~/specs/read"
import { wordsRaw, wrote } from "~/words"

export const openImage = (url: string) => void window.open(url, "_blank", "noopener,noreferrer")

export function CommentItem({
  channel,
  c,
  names,
  tasks,
  showQuote,
  onQuote,
  onReply,
  onRe,
}: {
  channel: Channel
  c: Comment
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  showQuote?: boolean
  onQuote?: () => void
  onReply?: () => void
  onRe?: () => void
}) {
  const { actions } = useAct()
  const to = c.re === undefined ? undefined : channel.messages.find((m) => m.seq === c.re)
  const settled = !c.m.pending && c.m.failed === undefined
  return (
    <article className={cx("spec-comment", c.m.pending && "is-pending", c.m.failed !== undefined && "is-failed")} data-seq={c.m.seq}>
      <header className="spec-comment-head">
        <Avatar person={faceOf(channel, c.m.from)} size="sm" />
        <span className="spec-comment-name">{nickname(channel, c.m.from)}</span>
        <time className="spec-comment-time">{clock(c.m.at)}</time>
        {settled && (
          <span className="msg-tools" role="toolbar" aria-label={t("specs.doc.comment.actions")}>
            {c.m.where.kind !== "theirs" &&
              QUICK.map((e) => (
                <button key={e} type="button" className="msg-tool" aria-label={t("chat.message.react", { emoji: e })} onClick={() => actions.react(channel.code, c.m.seq, e)}>
                  {e}
                </button>
              ))}
            {onReply && (
              <button type="button" className="msg-tool" aria-label={t("specs.doc.reply")} title={t("specs.doc.reply")} onClick={onReply}>
                <Icon name="reply" size={14} />
              </button>
            )}
            <button type="button" className="msg-tool" aria-label={t("chat.message.copy.text")} title={t("chat.message.copy.text")} onClick={() => copyText(c.text.trim() || wordsRaw(c.m.text))}>
              <Icon name="copy" size={14} />
            </button>
            <button type="button" className="msg-tool" aria-label={t("specs.doc.open.thread")} title={t("specs.doc.open.thread")} onClick={() => openMessage(channel.code, c.m.seq)}>
              <Icon name="thread" size={14} />
            </button>
          </span>
        )}
      </header>
      {to && onRe && (
        <button type="button" className="spec-comment-quote is-link" title={t("specs.doc.show.comment")} onClick={onRe}>
          <span>
            <b>{nickname(channel, to.from)}</b> {c.excerpt ? `“${preview(c.excerpt)}”` : preview(splitQuote(wordsRaw(to.text)).text)}
          </span>
        </button>
      )}
      {showQuote && c.quote && <p className="spec-comment-quote">{c.quote}</p>}
      {onQuote && c.quote && (
        <button type="button" className="spec-comment-quote is-link" title={t("specs.doc.show.line")} onClick={onQuote}>
          <span>{c.quote}</span>
        </button>
      )}
      {c.text.trim() && <Body text={wrote(c.text)} seq={c.m.seq} names={names} tasks={tasks} onImage={openImage} onMessage={() => {}} />}
      {c.m.images && <MessageImages code={channel.code} images={c.m.images} open={openImage} />}
      <Reacts channel={channel} m={c.m} />
      <Unsent channel={channel} m={c.m} />
    </article>
  )
}
