import type { PrChecks } from "@kiwi/core/work.ts"

export function ChecksWord({ checks }: { checks: PrChecks }) {
  if (checks.failed.length) return <span className="font-medium text-alert">, {checks.failed.length === 1 ? `${checks.failed[0]} failed` : `${checks.failed.length} checks failed`}</span>
  if (checks.running) return <span className="text-ink-3">, {checks.running} running</span>
  return <span className="text-live">, checks passed</span>
}
