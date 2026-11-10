import "~/i18n/en/chat-later"
import { useState } from "react"

import { Body } from "~/chat/body"
import { t } from "~/i18n/i18n"
import { Failed, failure, type Failure } from "~/kit/failed"
import { wrote } from "~/words"
import type { Channel, Compacted } from "~/model"
import { useAct } from "~/nav"
import { nickname, shown } from "~/names"
import { viewImage } from "~/chat/image-view"

const openImage = viewImage

interface Props {
  channel: Channel
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  onQuote: (seq: number) => void
}

export function HistoryFold({ channel, compact, earlier, onToggle, names, tasks, onQuote }: Props & { compact: Compacted; earlier: boolean; onToggle: () => void }) {
  return (
    <section className="compacted" aria-label={t("chat.compact.history")} data-seq={compact.seq}>
      <p className="fold">
        <span className="sys-line" />
        <span title={t("chat.compact.through", { seq: String(compact.through) })}>
          {compact.by === channel.you ? t("chat.compact.summed.up.you") : t("chat.compact.summed.up.by", { name: nickname(channel, compact.by) })}
        </span>
        <button type="button" className="fold-act" aria-expanded={earlier} onClick={onToggle}>
          {earlier ? t("chat.compact.hide.earlier") : t("chat.compact.show.earlier")}
        </button>
      </p>
      <div className="compacted-summary">
        <Body text={wrote(compact.summary)} seq={compact.seq} names={names} tasks={tasks} onImage={openImage} onMessage={onQuote} />
      </div>
    </section>
  )
}

export function ProposalCard({ channel, proposal, names, tasks, onQuote }: Props & { proposal: Compacted }) {
  const { actions } = useAct()
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState<Failure | null>(null)
  const owner = channel.people.find((p) => p.owner)
  return (
    <section className="compact-card" aria-label={t("chat.compact.proposed")} data-seq={proposal.seq}>
      <div className="ask">
        <p className="ask-title" title={t("chat.compact.through", { seq: String(proposal.through) })}>
          {proposal.by === channel.you ? t("chat.compact.you.propose") : t("chat.compact.proposes", { name: nickname(channel, proposal.by) })}
        </p>
        <Body text={wrote(proposal.summary)} seq={proposal.seq} names={names} tasks={tasks} onImage={openImage} onMessage={onQuote} />
        <div className="compact-foot">
          {channel.youOwn ? (
            <button
              type="button"
              className="btn is-primary is-small"
              disabled={sent}
              onClick={() => {
                setSent(true)
                setFailed(null)
                void actions.approveCompact(channel.code, proposal.seq).catch((err: unknown) => {
                  setFailed(failure(t("chat.compact.failed"), err))
                  setSent(false)
                })
              }}
            >
              {sent ? t("chat.compact.approving") : t("chat.compact.approve")}
            </button>
          ) : (
            <p className="ask-state">{owner ? t("chat.compact.waiting.for", { name: shown(owner) }) : t("chat.compact.waiting.owner")}</p>
          )}
          <p className="ask-state">{t("chat.compact.nothing.deleted")}</p>
        </div>
        {failed && <Failed failure={failed} />}
      </div>
    </section>
  )
}
