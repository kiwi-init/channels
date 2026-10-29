import { useState } from "react"

import { Body } from "~/chat/message"
import type { Channel, Compacted } from "~/model"
import { useAct } from "~/nav"
import { nickname, shown } from "~/names"

const openImage = (url: string) => void window.open(url, "_blank", "noopener,noreferrer")

interface Props {
  channel: Channel
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  onQuote: (seq: number) => void
}

export function HistoryFold({ channel, compact, earlier, onToggle, names, tasks, onQuote }: Props & { compact: Compacted; earlier: boolean; onToggle: () => void }) {
  return (
    <section className="compacted" aria-label="Compacted history" data-seq={compact.seq}>
      <p className="fold">
        <span className="sys-line" />
        <span>
          History through #{compact.through}, summed up by {compact.by === channel.you ? "you" : nickname(channel, compact.by)}
        </span>
        <button type="button" className="fold-act" aria-expanded={earlier} onClick={onToggle}>
          {earlier ? "Hide earlier messages" : "Show earlier messages"}
        </button>
      </p>
      <div className="compacted-summary">
        <Body text={compact.summary} seq={compact.seq} names={names} tasks={tasks} onImage={openImage} onMessage={onQuote} />
      </div>
    </section>
  )
}

export function ProposalCard({ channel, proposal, names, tasks, onQuote }: Props & { proposal: Compacted }) {
  const { actions } = useAct()
  const [sent, setSent] = useState(false)
  const owner = channel.people.find((p) => p.owner)
  return (
    <section className="compact-card" aria-label="Proposed compact" data-seq={proposal.seq}>
      <div className="ask is-open">
        <p className="ask-title">
          {proposal.by === channel.you ? "You propose" : `${nickname(channel, proposal.by)} proposes`} compacting the history through #{proposal.through}
        </p>
        <Body text={proposal.summary} seq={proposal.seq} names={names} tasks={tasks} onImage={openImage} onMessage={onQuote} />
        <p className="ask-state">Nothing is deleted: earlier messages fold behind this summary, and finished tasks archive.</p>
        {channel.youOwn ? (
          <button
            type="button"
            className="btn is-primary is-small"
            disabled={sent}
            onClick={() => {
              setSent(true)
              actions.approveCompact(channel.code, proposal.seq)
              window.setTimeout(() => setSent(false), 5_000)
            }}
          >
            Approve and compact
          </button>
        ) : (
          <p className="ask-state is-waiting">Waiting for {owner ? shown(owner) : "the owner"} to approve</p>
        )}
      </div>
    </section>
  )
}
