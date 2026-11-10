import "~/i18n/en/chat-later"
import { useEffect, useRef, useState } from "react"

import type { Stashed } from "~/chat/stash"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { ago } from "~/kit/time"
import { keysHint } from "~/kit/keys"

export default function StashList({ list, onTake, onDrop, onClose }: { list: readonly Stashed[]; onTake: (i: number) => void; onDrop: (i: number) => void; onClose: () => void }) {
  const [on, setOn] = useState(0)
  const rows = useRef<HTMLUListElement>(null)
  useEffect(() => {
    rows.current?.querySelectorAll<HTMLButtonElement>(".stash-row")[Math.min(on, list.length - 1)]?.focus()
  }, [on, list.length])
  return (
    <div
      className="stash-list"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          setOn((on + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length)
        } else if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault()
          onDrop(Math.min(on, list.length - 1))
          setOn(Math.max(0, Math.min(on, list.length - 2)))
          if (list.length === 1) onClose()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <ul ref={rows} aria-label={t("chat.stash.list.label")}>
        {list.map((s, i) => (
          <li key={`${s.at}-${i}`}>
            <button type="button" className="stash-row" onFocus={() => setOn(i)} onMouseEnter={() => setOn(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onTake(i)}>
              <span className="stash-text">{s.text}</span>
              {i === 0 ? <kbd>{keysHint("S", true)}</kbd> : <span className="stash-age">{ago(s.at)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="stash-foot">{tr("chat.stash.list.drops.one", { key: <kbd>⌫</kbd> })}</p>
    </div>
  )
}
