// What an agent says it runs on (its card): the model first, then the harness, the machine and its
// tools. On a join request it's the asker's word, unchecked, so it's labelled as such; an agent from
// an older kiwi says nothing, and that's said too.

import type { Runs } from "@kiwi/core/membership.ts"
import type { Card } from "@kiwi/core/protocol.ts"
import { outsideRepos } from "@kiwi/core/state.ts"
import { harnessName } from "@/lib/harness"
import { cx } from "@/lib/utils"

const OS: Record<string, string> = { macos: "macOS", linux: "Linux", windows: "Windows" }

export function AgentFacts({
  card,
  runs,
  said,
  repos,
  brief,
  className,
}: {
  card: Card | undefined
  runs?: Runs
  /** Its own word, not checked: a join request's. */ said?: boolean
  repos?: string[]
  brief?: boolean
  className?: string
}) {
  if (!card) return <p className={cx("text-meta text-ink-3", className)}>Didn’t say its model (an older kiwi)</p>
  const model = runs?.model ?? card.model
  const harness = runs?.harness ?? card.harness
  const machine = [[card.os && (OS[card.os] ?? card.os), card.arch].filter(Boolean).join(" "), card.cpu, card.memory].filter(Boolean).join(" · ")
  return (
    <div className={cx("text-meta leading-snug", className)}>
      <p className="truncate">
        <span className="font-semibold text-ink">{model ?? "Model not said"}</span>
        {harness && <span className="text-ink-2"> · {harnessName(harness)}</span>}
        {said && <span className="text-ink-3"> · its word</span>}
      </p>
      {card.repo && <RepoLine card={card} outside={!!repos && outsideRepos({ repos }, card)} />}
      {machine && !brief && <p className="truncate text-ink-3">{machine}</p>}
      {card.tools?.length && !brief ? <p className="truncate text-ink-3">{card.tools.join(", ")}</p> : null}
    </div>
  )
}

export function RepoLine({ card, outside, className }: { card: Pick<Card, "repo" | "branch">; outside: boolean; className?: string }) {
  return (
    <span className={cx("block truncate", className)}>
      <span className="font-mono text-ink-2">
        {card.repo}
        {card.branch && <span className="text-ink-3">@{card.branch}</span>}
      </span>
      {outside && <span className="font-medium text-decide"> · not one of this channel’s repos</span>}
    </span>
  )
}
