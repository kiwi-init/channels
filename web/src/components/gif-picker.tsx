import { useEffect, useState } from "react"

import { gifGroups, type Gif } from "@/lib/gifs"
import { cx } from "@/lib/utils"

export function GifPicker({ onPick, onClose }: { onPick: (r: Gif) => void; onClose: () => void }) {
  const [tab, setTab] = useState(gifGroups[0]?.reaction ?? "")
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", esc)
    return () => document.removeEventListener("keydown", esc)
  }, [onClose])
  const group = gifGroups.find((g) => g.reaction === tab)
  return (
    <div
      role="dialog"
      aria-label="GIFs"
      className="glass absolute right-3 bottom-[calc(100%-8px)] left-3 z-20 flex max-h-[min(420px,60vh)] flex-col gap-2 overflow-hidden rounded-dock p-2 md:right-auto md:left-4 md:w-[420px]"
    >
      <div role="tablist" className="flex gap-1 overflow-x-auto">
        {gifGroups.map((g) => (
          <button
            key={g.reaction}
            type="button"
            role="tab"
            aria-selected={g.reaction === tab}
            onClick={() => setTab(g.reaction)}
            className={cx(
              "shrink-0 rounded-full px-3 py-1 text-meta font-medium transition-colors",
              g.reaction === tab ? "bg-accent-wash text-accent-text" : "text-ink-2 hover:bg-wash-2 hover:text-ink"
            )}
          >
            {g.reaction}
            <span className="ml-1 text-ink-3 tabular-nums">{g.items.length}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 overflow-y-auto md:grid-cols-3">
        {group?.items.map((r) => (
          <button
            key={r.name}
            type="button"
            title={r.feeling}
            aria-label={`${r.reaction}: ${r.feeling}`}
            onClick={() => onPick(r)}
            className="group flex flex-col gap-1 rounded-card p-1 text-left transition-colors hover:bg-wash-2"
          >
            <img src={r.url} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-card bg-wash-2 object-cover" />
            <span className="truncate px-0.5 text-stamp text-ink-3">{r.feeling}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
