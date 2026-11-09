import { t } from "~/i18n/i18n"
import { Modal } from "~/kit/modal"
import { openOutside } from "~/kit/outside"
import type { Usage } from "~/model"
import { useApp } from "~/nav"
import { UsageBar } from "~/usage/meter"
import { closeLimit, useUsage, type LimitHit } from "~/usage/store"
import { canUpgrade, fairUse, paidPlanLine, resetsIn, upgradeLabel } from "~/usage/words"

export function LimitDialog({ hit }: { hit: LimitHit }) {
  const { app } = useApp()
  const usage = useUsage(app.actions.myUsage)
  const channel = hit.code !== null && app.channel?.code === hit.code ? app.channel : null
  const owner = channel?.people.find((p) => p.owner) ?? null
  const full = usage !== null && usage.limit !== null && usage.used >= usage.limit
  const mine = hit.code === null || owner?.you === true || (owner === null && full)
  const later = usage ? resetsIn(usage.resetsAt, usage.checkedAt) : null
  const again = later ? t("usage.again.in", { time: later }) : t("usage.again")
  if (!mine) {
    const who = owner ? (owner.display ?? owner.name) : t("usage.channel.owner")
    return (
      <Modal
        dismiss="outside"
        label={t("usage.channel.out")}
        title={t("usage.channel.out")}
        sub={t("usage.channel.out.sub", { who, again })}
        onClose={closeLimit}
        size="narrow"
        foot={
          <button type="button" className="btn is-primary" autoFocus onClick={closeLimit}>
            {t("usage.ok")}
          </button>
        }
      />
    )
  }
  const upgrade = usage && canUpgrade(usage) ? usage.upgradeUrl : null
  const limit = usage?.limit ?? null
  return (
    <Modal
      dismiss="outside"
      label={t("usage.used.up")}
      title={t("usage.used.up")}
      sub={limit === null ? t("usage.used.up.sub", { again }) : t("usage.used.up.count", { count: limit, plan: planLimit(usage), again })}
      onClose={closeLimit}
      size="narrow"
      foot={
        upgrade && usage ? (
          <>
            <button type="button" className="btn is-quiet" onClick={closeLimit}>
              {t("usage.not.now")}
            </button>
            <button
              type="button"
              className="btn is-primary"
              autoFocus
              onClick={() => {
                openOutside(upgrade)
                closeLimit()
              }}
            >
              {upgradeLabel(usage)}
            </button>
          </>
        ) : (
          <button type="button" className="btn is-primary" autoFocus onClick={closeLimit}>
            {t("usage.ok")}
          </button>
        )
      }
    >
      {usage && usage.limit !== null && (
        <div className="usage-limit">
          <UsageBar usage={usage} />
          {upgrade && paidPlanLine(usage) ? <p className="usage-limit-hint">{paidPlanLine(usage)}</p> : null}
        </div>
      )}
    </Modal>
  )
}

function planLimit(usage: Usage | null): string {
  if (usage && fairUse(usage)) return t("usage.limit.fair.use")
  return t(usage?.plan === "paid" ? "usage.limit.paid" : "usage.limit.free")
}
