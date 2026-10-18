import type { Chosen } from "@/lib/asks"
import { formatTime } from "@/lib/format"
import { cx } from "@/lib/utils"

const split = (c: string): [string | null, string] => {
  const m = /^([A-Z])\s*[:.)-]\s*(.*)$/s.exec(c)
  return m ? [m[1]!, m[2]!] : [null, c]
}

export function AskOptions({ choices, chosen, onChoose, nameOf }: { choices: readonly string[]; chosen?: Chosen; onChoose?: (choice: string) => void; nameOf: (name: string) => string }) {
  return (
    <ul aria-label="Options" className="mt-2 flex flex-col gap-1.5">
      {choices.map((c) => {
        const [letter, text] = split(c)
        const picked = chosen?.choice === c
        const body = (
          <>
            {letter && <span className={cx("w-4 shrink-0 font-semibold", picked ? "text-accent-text" : "text-ink-3")}>{letter}</span>}
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{text}</span>
            {picked && (
              <span className="shrink-0 text-meta text-accent-text">
                {nameOf(chosen.by)} chose this · <time className="tabular-nums">{formatTime(chosen.at)}</time>
              </span>
            )}
          </>
        )
        const look = cx("flex w-full items-baseline gap-2 rounded-row border px-3 py-1.5 text-left text-ui leading-snug", picked ? "border-accent" : "border-edge-strong")
        return (
          <li key={c}>
            {onChoose && !chosen ? (
              <button type="button" onClick={() => onChoose(c)} className={cx(look, "transition-colors hover:border-accent")}>
                {body}
              </button>
            ) : (
              <div className={look}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
