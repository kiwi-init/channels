import { ArrowDown01Icon, Cancel01Icon, Note01Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import type { TaskState } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { formatAgo } from "@/lib/format"
import { DECISION, STATE_LABEL } from "@/lib/task-labels"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { Alert, Button, IconButton, errorText, toast } from "./kit"

/** Where a task stands, as one small dot: grey up next, blue in progress, amber in review, green done. */
export function StateMark({ state }: { state: TaskState }) {
  return (
    <span title={STATE_LABEL[state]} className="flex size-4 shrink-0 items-center justify-center">
      <span className={cx("block size-2 rounded-full", state === "todo" && "bg-ink-3/55", state === "doing" && "bg-doing", state === "review" && "bg-decide", state === "done" && "bg-live")} />
    </span>
  )
}

export function DecisionMark() {
  return <span className="shrink-0 rounded-row bg-decide-wash px-1.5 text-meta font-semibold whitespace-nowrap text-decide">{DECISION}</span>
}

/**
 * What agents told each other to remember (facts), pinned above the conversation as one quiet block.
 * People read it and may clear a value; setting one is the agents' job.
 */
export function Notes({ state, now, onClear }: { state: ChannelState; now: number; onClear: (key: string) => Promise<void> }) {
  const facts = [...state.facts.values()].sort((a, b) => a.key.localeCompare(b.key))
  const [open, setOpen] = useState(true)
  const [clearing, setClearing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!facts.length) return null
  const clear = async (key: string) => {
    setBusy(true)
    try {
      await onClear(key)
      toast(`Cleared ${key}`)
      setClearing(null)
    } catch (err) {
      toast(`Not cleared: ${errorText(err)}`, "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label="Notes" className="overflow-hidden rounded-card edge">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3.5 text-left text-ui">
        <Icon icon={Note01Icon} size={15} className="shrink-0 text-ink-3" />
        <span className="font-medium">Notes</span>
        <span className="text-meta text-ink-3 tabular-nums">{facts.length}</span>
        {!open && <span className="min-w-0 flex-1 truncate text-meta text-ink-3">{facts.map((f) => f.key).join(", ")}</span>}
        <Icon icon={ArrowDown01Icon} size={14} className={cx("ml-auto shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line px-2 py-1.5">
          {facts.map((f) => (
            <div key={f.key} className="group flex items-start gap-1 rounded-ctl px-2 py-1.5 hover:bg-wash">
              <button type="button" className="min-w-0 flex-1 text-left" title="Copy value" onClick={() => navigator.clipboard.writeText(f.value).then(() => toast(`Copied ${f.key}`))}>
                <p className="flex min-w-0 items-baseline gap-2 text-ui">
                  <span className="shrink-0 font-medium">{f.key}</span>
                  <span className="truncate font-mono text-ink-2" title={f.value}>
                    {f.value}
                  </span>
                </p>
                <p className="text-meta text-ink-3">
                  {f.by} · {formatAgo(f.ts, now)}
                </p>
              </button>
              <IconButton
                label={`Clear ${f.key}`}
                className="size-7 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                onClick={() => setClearing(f.key)}
              >
                <Icon icon={Cancel01Icon} size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <Alert
        open={clearing !== null}
        onClose={() => setClearing(null)}
        title={`Clear ${clearing ?? "this note"}?`}
        message="Agents may be relying on it. It’s gone for everyone in the channel, and an agent can set it again."
      >
        <Button variant="secondary" onClick={() => setClearing(null)}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => clearing && void clear(clearing)}>
          Clear
        </Button>
      </Alert>
    </section>
  )
}
