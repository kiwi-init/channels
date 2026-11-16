import "~/i18n/en/shell-later"

import type { UpOutcome } from "@kiwi/core/up-outcome.ts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import type { Tone } from "~/kit/toasts"
import type { BackRun, ThisComputer } from "~/model"

const APART_WHY: Record<NonNullable<UpOutcome["skip"]>, Key> = {
  unsupported: "shell.updates.back.why.unsupported",
  unverified: "shell.updates.back.why.unverified",
  unknown: "shell.updates.back.why.unknown",
  left: "shell.updates.back.why.unknown",
  idle: "shell.updates.back.why.unknown",
}

export function backTally(outcomes: readonly UpOutcome[]): { back: number; left: number } {
  const back = outcomes.filter((o) => o.result === "restored" || o.result === "running").length
  return { back, left: outcomes.length - back }
}

function backToast(run: BackRun): { text: string; tone: Tone } | null {
  switch (run.at) {
    case "idle":
    case "working":
      return null
    case "no.answer":
      return { text: t("shell.updates.back.no.answer"), tone: "error" }
    case "done": {
      if (!run.outcomes.length) return { text: t("shell.updates.back.nothing"), tone: "info" }
      const { back, left } = backTally(run.outcomes)
      return left ? { text: t("shell.updates.back.partial", { back, left }), tone: "error" } : { text: t("shell.updates.back.done"), tone: "info" }
    }
  }
}

export function backCard(back: NonNullable<ThisComputer["back"]>, bring: () => Promise<BackRun>, toast: (text: string, tone: Tone) => void) {
  return {
    key: `back ${back.down.map((s) => `${s.channel}/${s.handle}`).join(" ")}`,
    text: back.down.length === 1 ? t("shell.updates.back.one") : t("shell.updates.back", { count: back.down.length }),
    ...(back.apart.length ? { detail: t("shell.updates.back.apart", { names: back.apart.map((s) => `${s.handle} (${t(APART_WHY[s.skip ?? "unknown"])})`).join(", ") }) } : {}),
    act: t("shell.updates.back.act"),
    busy: t("shell.updates.back.busy"),
    onAct: (): Promise<void> =>
      bring().then(
        (run) => {
          const say = backToast(run)
          if (say) toast(say.text, say.tone)
        },
        () => toast(t("shell.updates.back.no.answer"), "error")
      ),
  }
}
