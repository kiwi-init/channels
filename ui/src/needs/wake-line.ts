import "~/i18n/en/needs"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { lasting } from "~/kit/time"
import type { WakeSeen } from "~/model"

const WAKES: Readonly<Record<Exclude<WakeSeen["kind"], "none">, Key>> = { attempted: "needs.quiet.wake.attempted", delivered: "needs.quiet.wake.delivered", read: "needs.quiet.wake.read" }

export function wakeLine(wake: WakeSeen, now: number): string {
  return wake.kind === "none" ? t("needs.quiet.wake.none") : t(WAKES[wake.kind], { time: lasting(now - wake.attempted) })
}
