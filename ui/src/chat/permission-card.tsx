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
          {ask.answer.allow ? "Allowed" : "Denied"} by {ask.answer.by === channel.you ? "you" : nickname(channel, ask.answer.by)} <time>{clock(ask.answer.at)}</time>
        </p>
      ) : (
        <>
          <div className="actions">
            <button type="button" className="btn is-primary is-small" onClick={() => actions.answerPermission(channel.code, ask.id, true)}>
              Allow
            </button>
            <button type="button" className="btn is-small" onClick={() => actions.answerPermission(channel.code, ask.id, false)}>
              Deny
            </button>
          </div>
        </>
      )}
    </div>
  )
}
