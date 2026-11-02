import { useEffect, useState } from "react"

import { useApp } from "~/nav"

type Card = { key: string; text: string; act?: string; busy?: string; onAct?: () => void; progress?: number }

function useCards(): Card[] {
  const { app, go } = useApp()
  const account = app.account
  const cards: Card[] = []
  const ask = account?.enrollAsk
  if (ask && ask.stage !== "elsewhere") cards.push({ key: "ask", text: `${ask.label} wants to sign in as you`, act: "Review", onAct: () => go({ to: "settings", section: "computers" }) })
  const words = account?.recovery?.pending
  if (words) {
    const day = new Date(words.from).toLocaleDateString(undefined, { day: "numeric", month: "short" })
    cards.push({ key: `words ${words.from}`, text: `New recovery words take over ${day}. Not you?`, act: "Review", onAct: () => go({ to: "settings", section: "computers" }) })
  }
  if (account?.uiUpdate) cards.push({ key: "look", text: "A new look is ready", act: "Switch", onAct: () => app.actions.applyUi() })
  const update = account?.update
  if (update) {
    const state = update.state ?? (update.ready ? "ready" : "downloading")
    const install = () => app.actions.installUpdate()
    const key = `update ${update.version} ${state}`
    cards.push(
      state === "ready"
        ? { key, text: `Channels ${update.version} is ready`, act: "Restart", busy: "Restarting…", onAct: install }
        : state === "available"
          ? update.blocked
            ? { key, text: `Channels ${update.version} is out`, act: "Get it", onAct: install }
            : { key, text: `Channels ${update.version} is out`, act: "Update", busy: "Checking…", onAct: install }
          : { key, text: `Downloading Channels ${update.version}`, progress: update.progress ?? 0 }
    )
  }
  return cards
}

function SideCard({ card }: { card: Card }) {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => setBusy(false), 30_000)
    return () => clearTimeout(t)
  }, [busy])
  const pct = card.progress === undefined ? null : Math.round(card.progress * 100)
  return (
    <li className="side-card">
      <span className="side-card-text">
        {card.text}
        {pct !== null && <span className="side-card-pct">{pct > 0 ? ` · ${pct}%` : "…"}</span>}
      </span>
      {card.act && (
        <button
          type="button"
          className="btn is-small"
          disabled={busy}
          onClick={() => {
            if (card.busy) setBusy(true)
            card.onAct?.()
          }}
        >
          {busy && card.busy ? card.busy : card.act}
        </button>
      )}
      {pct !== null && (
        <span className="side-card-bar" role="progressbar" aria-label={card.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span className="side-card-fill" style={{ inlineSize: `${pct}%` }} />
        </span>
      )}
    </li>
  )
}

export function SideCards() {
  const cards = useCards()
  if (!cards.length) return null
  return (
    <ul className="side-cards" aria-label="Waiting on you">
      {cards.map((c) => (
        <SideCard key={c.key} card={c} />
      ))}
    </ul>
  )
}

export function SideFoot() {
  return (
    <div className="side-foot">
      <SideCards />
    </div>
  )
}
