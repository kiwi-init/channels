import "~/i18n/en/shell-later"
import { Fragment, useEffect, useState } from "react"

import { Icon } from "~/kit/icons"
import { copyText } from "~/kit/toasts"
import { useGo, useActions, useAppAccount } from "~/nav"
import { t } from "~/i18n/i18n"

type Card = { key: string; text: string; detail?: string; path?: string; act?: string; busy?: string; onAct?: () => void; progress?: number }

function useCards(): Card[] {
  const go = useGo()
  const actions = useActions()
  const account = useAppAccount()
  const cards: Card[] = []
  const ask = account?.enrollAsk
  if (ask && ask.stage !== "elsewhere")
    cards.push({ key: "ask", text: t("shell.updates.sign.in.ask", { name: ask.label }), act: t("shell.updates.review"), onAct: () => go({ to: "settings", section: "computers" }) })
  const moved = account?.moved
  if (moved)
    cards.push({
      key: `moved ${moved.to}`,
      text: t("shell.updates.moved", { path: moved.to.slice(0, moved.to.lastIndexOf("/")) || moved.to }),
      ...(moved.from ? { detail: t("shell.updates.moved.old.copy"), path: moved.from } : { detail: t("shell.updates.moved.delete.copy") }),
      act: t("shell.updates.ok"),
      onAct: () => actions.dismissMoved(),
    })
  if (account?.uiUpdate) cards.push({ key: "look", text: t("shell.updates.look.ready"), act: t("shell.updates.switch"), onAct: () => actions.applyUi() })
  const update = account?.update
  if (update) {
    const state = update.state ?? (update.ready ? "ready" : "downloading")
    const install = () => actions.installUpdate()
    const key = `update ${update.version} ${state}`
    cards.push(
      state === "ready"
        ? { key, text: t("shell.updates.ready", { version: update.version }), act: t("shell.updates.restart"), busy: t("shell.updates.restarting"), onAct: install }
        : state === "available"
          ? update.blocked
            ? { key, text: t("shell.updates.out", { version: update.version }), act: t("shell.updates.get.it"), onAct: install }
            : { key, text: t("shell.updates.out", { version: update.version }), act: t("shell.updates.update"), busy: t("shell.updates.checking"), onAct: install }
          : { key, text: t("shell.updates.downloading", { version: update.version }), progress: update.progress ?? 0 }
    )
  }
  return cards
}

function CopyPath({ path }: { path: string }) {
  const parts = path.split("/")
  return (
    <button type="button" className="side-card-path" title={t("shell.updates.copy.path")} onClick={() => copyText(path, t("shell.updates.path.copied"))}>
      <Icon name="copy" size={12} />
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              /<wbr />
            </>
          )}
          {part}
        </Fragment>
      ))}
    </button>
  )
}

function SideCard({ card }: { card: Card }) {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(() => setBusy(false), 30_000)
    return () => clearTimeout(timer)
  }, [busy])
  const pct = card.progress === undefined ? null : Math.round(card.progress * 100)
  return (
    <li className="side-card">
      <span className="side-card-text">
        {card.text}
        {pct !== null && <span className="side-card-pct">{pct > 0 ? ` · ${pct}%` : "…"}</span>}
        {card.detail && <span className="side-card-detail">{card.detail}</span>}
        {card.path && <CopyPath path={card.path} />}
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
    <ul className="side-cards" aria-label={t("shell.updates.waiting.on.you")}>
      {cards.map((c) => (
        <SideCard key={c.key} card={c} />
      ))}
    </ul>
  )
}

export function RailCards() {
  const cards = useCards()
  if (!cards.length) return null
  return (
    <div className="rail-cards">
      <ul className="side-cards" aria-label={t("shell.updates.waiting.on.you")}>
        {cards.map((c) => (
          <SideCard key={c.key} card={c} />
        ))}
      </ul>
    </div>
  )
}
