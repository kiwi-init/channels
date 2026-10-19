import { useState } from "react"

import { bridge } from "@/lib/secrets"
import { openRelease, restartToUpdate, useUpdate, type UpdateCheckView } from "@/lib/update"
import { Button } from "./kit"

function said(u: UpdateCheckView | null): string {
  if (!u) return "Channels looks for a newer release every few hours."
  switch (u.state) {
    case "current":
      return `Channels ${u.version} is the latest.`
    case "failed":
      return "Couldn't reach GitHub. Try again in a moment."
    case "downloading":
      return `Downloading Channels ${u.version}…`
    case "ready":
      return `Channels ${u.version} is ready. It goes in when you restart.`
    case "available":
      return u.reason ? `Channels ${u.version} is out. ${u.reason}` : `Channels ${u.version} is out. Install it from the release.`
  }
}

export function UpdateCheck() {
  const b = bridge()
  const live = useUpdate()
  const [found, setFound] = useState<UpdateCheckView | null>(null)
  const [busy, setBusy] = useState(false)
  if (!b?.checkUpdate) return null
  const shown = live ?? found
  const check = () => {
    setBusy(true)
    b.checkUpdate()
      .then(setFound, () => setFound({ state: "failed" }))
      .finally(() => setBusy(false))
  }
  return (
    <div>
      <p className="mb-2 text-ui font-medium text-ink">Updates</p>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-ui leading-normal text-ink-2" role="status">
          {busy ? "Checking…" : said(shown)}
        </p>
        {live?.state === "ready" ? (
          <Button variant="secondary" onClick={restartToUpdate}>
            Restart to update
          </Button>
        ) : live?.state === "available" ? (
          <Button variant="secondary" onClick={() => openRelease(live)}>
            Open release
          </Button>
        ) : (
          <Button variant="secondary" onClick={check} disabled={busy || live?.state === "downloading"}>
            Check for updates
          </Button>
        )}
      </div>
    </div>
  )
}
