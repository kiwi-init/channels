import "~/i18n/en/settings"

import type { UpOutcome, UpResult } from "@kiwi/core/up-outcome.ts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import type { BackRun } from "~/model"
import { esc, row, say, type Acts } from "~/settings/sheet"
import { backTally } from "~/shell/back-card"

const BACK_SAYS: Record<UpResult, { key: Key; mark: "fine" | "bad" | "offline" | "waiting" }> = {
  restored: { key: "settings.agents.back.restored", mark: "fine" },
  running: { key: "settings.agents.back.running", mark: "fine" },
  skipped: { key: "settings.agents.back.skipped", mark: "offline" },
  failed: { key: "settings.agents.back.failed", mark: "bad" },
  printed: { key: "settings.agents.back.printed", mark: "waiting" },
  planned: { key: "settings.agents.back.planned", mark: "waiting" },
}

function outcomeRow(o: UpOutcome): string {
  const says = BACK_SAYS[o.result]
  const why = o.result === "printed" ? `\`${o.why}\`` : esc(o.why)
  return row({ mark: says.mark, label: `${o.handle} · ${o.channel}`, hint: `${esc(t(says.key))}: ${why}` })
}

export function backRow(run: BackRun, a: Acts, bring: () => void): string {
  const done = run.at === "done" ? run.outcomes : null
  return row({
    label: t("settings.agents.back"),
    hint: done
      ? done.length
        ? say("settings.agents.back.done", backTally(done))
        : say("settings.agents.back.none")
      : run.at === "no.answer"
        ? say("settings.agents.back.no.answer", {}, { command: "kiwi up" })
        : say("settings.agents.back.hint"),
    line: a.act(run.at === "working" ? t("settings.agents.back.working") : t("settings.agents.back.run"), () => {
      if (run.at !== "working") bring()
    }),
    nested: done ? [done.map(outcomeRow).join("\n")] : [],
  })
}
