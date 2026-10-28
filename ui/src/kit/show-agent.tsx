import { useState } from "react"

import { PLACE_NAMES } from "@kiwi/core/terminals.ts"
import type { Channel, Person } from "~/model"
import { useApp } from "~/nav"

export function ShowAgent({ channel, person, className = "btn" }: { channel: Channel; person: Pick<Person, "name" | "seat"> | undefined; className?: string }) {
  const { app, toast } = useApp()
  const [busy, setBusy] = useState(false)
  if (!person?.seat) return null
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void app.actions
          .showAgent(channel.code, person.name)
          .then((note) => note && toast(note))
          .finally(() => setBusy(false))
      }}
    >
      Show in {PLACE_NAMES[person.seat]}
    </button>
  )
}
