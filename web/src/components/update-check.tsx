import { Download04Icon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import { bridge } from "@/lib/secrets"
import { openRelease, restartToUpdate, useUpdate, type UpdateCheckView } from "@/lib/update"
import { Icon } from "./icon"
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
      if (u.blocked) return "Channels can't update itself here. Get it from the release."
      return u.deb ? `Channels ${u.version} is out. Download the new .deb and open it to install.` : `Channels ${u.version} is out. Install it from the release.`
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
    <div data-item className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-5 shrink-0 items-center justify-center text-ink-2">
          <Icon icon={Download04Icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-ink">Updates</p>
          <p className="text-meta leading-snug text-ink-3" role="status">
            {busy ? "Checking…" : said(shown)}
          </p>
        </div>
        {live?.state === "ready" ? (
          <Button size="sm" variant="secondary" onClick={restartToUpdate}>
            Restart to update
          </Button>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {live?.state === "available" && (
              <Button size="sm" variant="secondary" onClick={() => openRelease(live)}>
                {live.deb ? "Download .deb" : "Open release"}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={check} disabled={busy || live?.state === "downloading"}>
              Check for updates
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
