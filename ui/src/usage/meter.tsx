import "~/styles/usage.css"

import { useEffect, useRef, useState } from "react"

import { cx } from "~/kit/bits"
import { OutsideLink } from "~/kit/outside"
import type { Usage } from "~/model"
import { t } from "~/i18n/i18n"
import { useActions, useGo } from "~/nav"
import { showLimit, useUsage } from "~/usage/store"
import { canUpgrade, levelOf, planName, resetsIn, seemsUnlimited, shareOf, upgradeLabel, usageHint, usedOf, utcDay } from "~/usage/words"

const R = 7
const ROUND = 2 * Math.PI * R
const SHOWN_KEY = "kiwi.limit-shown"

export function UsageBar({ usage }: { usage: Usage }) {
  return (
    <span className={cx("usage-bar", `is-${levelOf(usage)}`)} aria-hidden="true">
      <span style={{ width: `${shareOf(usage) * 100}%` }} />
    </span>
  )
}

function Ring({ usage }: { usage: Usage }) {
  return (
    <svg className={cx("usage-ring", `is-${levelOf(usage)}`)} viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <circle cx="9" cy="9" r={R} />
      <circle cx="9" cy="9" r={R} strokeDasharray={ROUND} strokeDashoffset={ROUND * (1 - shareOf(usage))} transform="rotate(-90 9 9)" />
    </svg>
  )
}

function shownToday(day: string): boolean {
  try {
    if (localStorage.getItem(SHOWN_KEY) === day) return true
    localStorage.setItem(SHOWN_KEY, day)
  } catch {
    // No storage: the limit dialog may show again after a reload, which is harmless.
  }
  return false
}

export function UsageMeter() {
  const actions = useActions()
  const go = useGo()
  const usage = useUsage(actions.myUsage)
  const [at, setAt] = useState<DOMRect | null>(null)
  const open = at !== null
  const setOpen = (on: boolean) => setAt(on ? (button.current?.getBoundingClientRect() ?? null) : null)
  const button = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const full = usage !== null && levelOf(usage) === "full"
  useEffect(() => {
    if (full && !shownToday(utcDay(Date.now()))) showLimit(null)
  }, [full])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (!card.current?.contains(t) && !button.current?.contains(t)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("pointerdown", away, true)
    window.addEventListener("keydown", key)
    return () => {
      window.removeEventListener("pointerdown", away, true)
      window.removeEventListener("keydown", key)
    }
  }, [open])
  if (!usage || usage.limit === null || seemsUnlimited(usage)) return null
  const label = t("usage.today.label", { used: usedOf(usage) })
  return (
    <>
      <button ref={button} type="button" className={cx("rail-usage", open && "is-on")} aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Ring usage={usage} />
      </button>
      {at && (
        <div ref={card} className="usage-card" role="dialog" aria-label={t("usage.today")} style={{ left: at.right + 8, bottom: window.innerHeight - at.bottom }}>
          <div className="usage-card-head">
            <span>{t("usage.today")}</span>
            <span className="usage-card-plan">{planName(usage)}</span>
          </div>
          <div className="usage-card-count">
            <strong>{usedOf(usage)}</strong>
          </div>
          <UsageBar usage={usage} />
          <p className="usage-card-hint">{usageHint(usage, resetsIn(usage.resetsAt, usage.checkedAt))}</p>
          <div className="usage-card-acts">
            <button
              type="button"
              className="btn is-small is-quiet"
              onClick={() => {
                setOpen(false)
                go({ to: "settings", section: "account" })
              }}
            >
              {t("usage.account")}
            </button>
            {canUpgrade(usage) && usage.upgradeUrl && (
              <OutsideLink className="btn is-small is-primary" href={usage.upgradeUrl}>
                {upgradeLabel(usage)}
              </OutsideLink>
            )}
          </div>
        </div>
      )}
    </>
  )
}
