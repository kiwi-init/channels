import "~/i18n/en/chat-later"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { clock } from "~/kit/time"
import type { Channel, PermissionAsk } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"

export default function PermissionCard({ channel, ask }: { channel: Channel; ask: PermissionAsk }) {
  const { actions } = useAct()
  return (
    <div className="ask">
      <p className="ask-title">
        {ask.summary ? (
          <>
            {ask.summary} <span className="dim">· {ask.tool}</span>
          </>
        ) : (
          ask.tool
        )}
      </p>
      <pre className="ask-code">{ask.code}</pre>
      {ask.answer ? (
        <p className="ask-state">
          {tr(ask.answer.allow ? "chat.permission.card.allowed" : "chat.permission.card.denied", {
            who: ask.answer.by === channel.you ? t("chat.permission.card.you") : nickname(channel, ask.answer.by),
            time: <time>{clock(ask.answer.at)}</time>,
          })}
        </p>
      ) : (
        <>
          <div className="actions">
            <button type="button" className="btn is-small" onClick={() => actions.answerPermission(channel.code, ask.id, false)}>
              {t("chat.permission.card.deny")}
            </button>
            <button type="button" className="btn is-primary is-small" onClick={() => actions.answerPermission(channel.code, ask.id, true)}>
              {t("chat.permission.card.allow")}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
