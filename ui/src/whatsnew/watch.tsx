import { useEffect, useState } from "react"

import { markSeen, useAsked, useSeen } from "~/whatsnew/features"
import { freshInstall } from "~/whatsnew/fresh"
import { NOTES } from "~/whatsnew/list"
import { WhatsNew } from "~/whatsnew/whats-new"

const quiet = (): boolean => navigator.webdriver || new URLSearchParams(location.search).has("shot")

export function WhatsNewWatch() {
  const seen = useSeen()
  const asked = useAsked()
  const [closed, setClosed] = useState(0)
  const [auto] = useState(() => !quiet() && !freshInstall)
  useEffect(() => {
    if (freshInstall) markSeen(NOTES.map((n) => n.id))
  }, [])
  const fresh = auto ? NOTES.filter((n) => !seen.includes(n.id)) : []
  const wanted = asked > closed
  if (!wanted && !fresh.length) return null
  return <WhatsNew notes={wanted ? NOTES : fresh} onClose={() => setClosed(asked)} />
}
