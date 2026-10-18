import type { Command } from "@/lib/commands"
import { cx } from "@/lib/utils"

export function CommandList({ commands, picked, onPick }: { commands: readonly Command[]; picked: Command; onPick: (command: Command) => void }) {
  return (
    <div role="listbox" aria-label="Commands" className="animate-rise absolute bottom-full left-14 z-20 mb-1 w-80 max-w-[calc(100%-4rem)] overflow-hidden rounded-card bg-raised p-1 shadow-pop">
      {commands.map((c) => (
        <button
          key={c.name}
          type="button"
          role="option"
          aria-selected={c === picked}
          onMouseDown={(e) => (e.preventDefault(), onPick(c))}
          className={cx("flex w-full items-baseline gap-2 rounded-row px-2.5 py-1.5 text-left text-ui", c === picked ? "bg-wash-2" : "hover:bg-wash")}
        >
          <span className="shrink-0 font-medium">/{c.name}</span>
          {c.args && <span className="shrink-0 text-ink-3">{c.args}</span>}
          <span className="min-w-0 truncate text-ink-3">{c.summary}</span>
        </button>
      ))}
    </div>
  )
}

export function CommandBar({ command, args }: { command: Command; args: string }) {
  return (
    <p className="mb-1.5 ml-3 flex items-baseline gap-2 px-2 text-meta text-ink-2">
      <span className="font-medium text-ink">/{command.name}</span>
      <span className="min-w-0 truncate">{command.summary}</span>
      <span className="ml-auto shrink-0 text-ink-3">Return runs it{command.args && !args ? ` · ${command.args}` : ""}</span>
    </p>
  )
}
