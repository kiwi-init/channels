import { useState } from "react"

export function SendBack({ onSend, onCancel }: { onSend: (why: string) => void; onCancel: () => void }) {
  const [why, setWhy] = useState("")
  return (
    <form
      className="task-sendback"
      onSubmit={(e) => {
        e.preventDefault()
        if (why.trim()) onSend(why.trim())
      }}
    >
      <input
        autoFocus
        className="input"
        value={why}
        aria-label="What needs to change"
        placeholder="What needs to change?"
        onChange={(e) => setWhy(e.target.value)}
        onBlur={() => !why.trim() && onCancel()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <button type="submit" className="btn is-primary" disabled={!why.trim()}>
        Send
      </button>
    </form>
  )
}
