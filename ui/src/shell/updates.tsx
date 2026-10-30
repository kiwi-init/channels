import { useApp } from "~/nav"

type Card = { key: string; text: string; act?: string; onAct?: () => void }

function useCards(): Card[] {
  const { app, go } = useApp()
  const account = app.account
  const cards: Card[] = []
  const ask = account?.enrollAsk
  if (ask && ask.stage !== "elsewhere") cards.push({ key: "ask", text: `${ask.label} wants to sign in as you`, act: "Review", onAct: () => go({ to: "settings", section: "computers" }) })
  if (account?.uiUpdate) cards.push({ key: "look", text: "A new look is ready", act: "Switch", onAct: () => app.actions.applyUi() })
  const update = account?.update
  if (update) {
    const state = update.state ?? (update.ready ? "ready" : "downloading")
    const install = () => app.actions.installUpdate()
    cards.push(
      state === "ready"
        ? { key: "update", text: `Channels ${update.version} is ready`, act: "Restart", onAct: install }
        : state === "available"
          ? { key: "update", text: `Channels ${update.version} is out`, act: "Update", onAct: install }
          : { key: "update", text: `Downloading Channels ${update.version}…` }
    )
  }
  return cards
}

export function SideCards() {
  const cards = useCards()
  if (!cards.length) return null
  return (
    <ul className="side-cards" aria-label="Waiting on you">
      {cards.map((c) => (
        <li key={c.key} className="side-card">
          <span className="side-card-text">{c.text}</span>
          {c.act && (
            <button type="button" className="btn is-small" onClick={c.onAct}>
              {c.act}
            </button>
          )}
        </li>
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
