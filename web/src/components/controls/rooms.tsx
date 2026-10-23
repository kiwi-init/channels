import { useState } from "react"

import { GENERAL_ROOM } from "@kiwi/core/protocol.ts"
import type { Room } from "@kiwi/core/state/types.ts"
import { cleanRoomName, roomProblem } from "@/lib/rooms"
import { Button, errorText, toast } from "../kit"

const field = "min-w-0 flex-1 bg-transparent text-ui text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"

export function Rooms({ rooms, onMake, onRename }: { rooms: readonly Room[]; onMake?: (name: string) => Promise<void>; onRename?: (id: string, name: string) => Promise<void> }) {
  const [name, setName] = useState("")
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const ordered = [...rooms].sort((a, b) => (a.id === GENERAL_ROOM ? -1 : b.id === GENERAL_ROOM ? 1 : a.at - b.at))
  const problem = name.trim() ? roomProblem(rooms, name) : null
  const renameProblem = renaming && renaming.name.trim() ? roomProblem(rooms, renaming.name, renaming.id) : null
  const unchanged = !!renaming && cleanRoomName(renaming.name) === rooms.find((r) => r.id === renaming.id)?.name
  const act = async (fn: () => Promise<void>, done: string, after: () => void) => {
    setBusy(true)
    try {
      await fn()
      toast(done)
      after()
    } catch (err) {
      toast(errorText(err), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="px-4 pt-1 pb-6">
      <h2 className="text-title font-semibold tracking-[-0.01em]">Rooms</h2>
      <p className="mt-1 text-ui leading-normal text-ink-2">A room is one front of the work in this channel, such as #mobile. Everyone in the channel can read and post in every room.</p>
      <ul aria-label="This channel's rooms" className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-1">
        {ordered.map((r) =>
          renaming?.id === r.id ? (
            <li key={r.id}>
              <form
                className="flex items-center gap-2 rounded-row px-3 py-1 edge"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!renameProblem && !unchanged)
                    void act(
                      () => onRename!(r.id, renaming.name),
                      `Renamed to #${cleanRoomName(renaming.name)}`,
                      () => setRenaming(null)
                    )
                }}
              >
                <span className="text-ui text-ink-3">#</span>
                <input
                  autoFocus
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: r.id, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setRenaming(null))}
                  aria-label={`New name for #${r.name}`}
                  spellCheck={false}
                  className={field}
                />
                <Button size="sm" variant="secondary" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" disabled={busy || !renaming.name.trim() || !!renameProblem || unchanged}>
                  Save
                </Button>
              </form>
              {renameProblem && <p className="mt-1 px-3 text-meta text-alert">{renameProblem}</p>}
            </li>
          ) : (
            <li key={r.id} className="flex items-center gap-2 rounded-row px-3 py-1.5 edge">
              <span className="min-w-0 flex-1 truncate text-ui">
                <span className="text-ink-3">#</span>
                {r.name}
              </span>
              {onRename && (
                <Button size="sm" variant="ghost" aria-label={`Rename #${r.name}`} disabled={busy} onClick={() => setRenaming({ id: r.id, name: r.name })}>
                  Rename
                </Button>
              )}
            </li>
          )
        )}
      </ul>
      {onMake && (
        <form
          className="mt-5 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !problem)
              void act(
                () => onMake(name),
                `Made #${cleanRoomName(name)}`,
                () => setName("")
              )
          }}
        >
          <label className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-ctl px-3 edge focus-within:shadow-[inset_0_0_0_1px_var(--ring)]">
            <span className="text-ui text-ink-3">#</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mobile" aria-label="New room’s name" spellCheck={false} className={field} />
          </label>
          <Button type="submit" disabled={busy || !name.trim() || !!problem}>
            New room
          </Button>
        </form>
      )}
      {problem && <p className="mt-1.5 text-meta text-alert">{problem}</p>}
    </div>
  )
}
