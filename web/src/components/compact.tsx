import { useState } from "react"
import type { Compact } from "@kiwi/core/state.ts"
import { Button, errorText, toast } from "./kit"
import { Markdown } from "./lazy"

export function CompactBlock({ compact, byName, earlier, onToggle }: { compact: Compact; byName: string; earlier: boolean; onToggle: () => void }) {
  return (
    <section aria-label="Compacted history" className="mx-auto my-3 flex w-full max-w-[34rem] flex-col gap-2 rounded-card bg-raised px-3.5 py-3 shadow-[0_0_0_1px_var(--line)]">
      <p className="text-stamp font-semibold tracking-[0.04em] text-ink-3 uppercase">History through #{compact.through}, summed up</p>
      <div className="text-body">
        <Markdown>{compact.summary}</Markdown>
      </div>
      <p className="flex items-center justify-between gap-2 text-meta text-ink-3">
        <span>Compacted by {byName}</span>
        <button type="button" onClick={onToggle} className="font-medium text-accent-text hover:underline">
          {earlier ? "Hide earlier messages" : "Show earlier messages"}
        </button>
      </p>
    </section>
  )
}

export function ProposalCard({ proposal, byName, approve }: { proposal: Compact; byName: string; approve?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!approve) return
    setBusy(true)
    try {
      await approve()
      toast(`History through #${proposal.through} compacted`)
    } catch (err) {
      toast(`Not compacted: ${errorText(err)}`, "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Proposed compact" className="mx-auto my-3 flex w-full max-w-[34rem] flex-col gap-2 rounded-card bg-raised px-3.5 py-3 shadow-[0_0_0_1px_var(--line)]">
      <p className="text-stamp font-semibold tracking-[0.04em] text-ink-3 uppercase">
        {byName} proposes compacting the history through #{proposal.through}
      </p>
      <div className="text-body">
        <Markdown>{proposal.summary}</Markdown>
      </div>
      <p className="flex items-center justify-between gap-2 text-meta text-ink-3">
        <span>Nothing is deleted: earlier messages fold behind this summary, finished tasks archive.</span>
        {approve && (
          <Button size="sm" onClick={() => void run()} disabled={busy}>
            Approve and compact
          </Button>
        )}
      </p>
    </section>
  )
}
