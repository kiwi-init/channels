// What an agent says it runs on (its card): the model first, then the harness, the machine and its
// tools. On a join request it's the asker's word, unchecked, so it's labelled as such; an agent from
// an older kiwi says nothing, and that's said too.

import type { Card } from "@mc/protocol.ts"
import { cx } from "@/lib/utils"

const HARNESS: Record<string, string> = { claude: "Claude Code", "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode", grok: "Grok", gemini: "Gemini CLI", cursor: "Cursor" }
const OS: Record<string, string> = { macos: "macOS", linux: "Linux", windows: "Windows" }

export function AgentFacts({ card, said, className }: { card: Card | undefined; /** Its own word, not checked: a join request's. */ said?: boolean; className?: string }) {
  if (!card) return <p className={cx("text-meta text-ink-3", className)}>Didn’t say its model (an older kiwi)</p>
  const machine = [[card.os && (OS[card.os] ?? card.os), card.arch].filter(Boolean).join(" "), card.cpu, card.memory].filter(Boolean).join(" · ")
  return (
    <div className={cx("text-meta leading-snug", className)}>
      <p className="truncate">
        <span className="font-semibold text-ink">{card.model ?? "Model not said"}</span>
        {card.harness && <span className="text-ink-2"> · {HARNESS[card.harness] ?? card.harness}</span>}
        {said && <span className="text-ink-3"> · its word</span>}
      </p>
      {machine && <p className="truncate text-ink-3">{machine}</p>}
      {card.tools?.length ? <p className="truncate text-ink-3">{card.tools.join(", ")}</p> : null}
    </div>
  )
}
