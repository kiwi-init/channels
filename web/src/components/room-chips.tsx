import { cx } from "@/lib/utils"

export function RoomChips({ rooms, value, onChange }: { rooms: readonly { id: string; name: string }[]; value: string; onChange: (room: string) => void }) {
  return (
    <div role="group" aria-label="Rooms" className="mb-2 flex flex-wrap gap-1.5">
      {rooms.map((r) => (
        <button
          key={r.id}
          type="button"
          aria-pressed={r.id === value}
          onClick={() => onChange(r.id)}
          className={cx(
            "inline-flex h-6 items-center rounded-row px-2.5 text-meta font-medium transition-colors",
            r.id === value ? "bg-accent-wash text-accent-text" : "bg-wash-2 text-ink-2 hover:bg-wash"
          )}
        >
          #{r.name}
        </button>
      ))}
    </div>
  )
}
