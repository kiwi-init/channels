import "~/i18n/en/live-later"
import type { Reason } from "@kiwi/core/routing.ts"
import { t } from "~/i18n/i18n"

function whyWords(r: Reason): string {
  const task = `T${r.task}`
  switch (r.kind) {
    case "worked":
      return t("live.why.worked", { task })
    case "from":
      return t("live.why.from", { task })
    case "follow-up":
      return t("live.why.follow.up", { task })
    case "sibling":
      return t("live.why.sibling", { task, parent: `T${r.parent}` })
    case "grand":
      return t("live.why.grand", { task, parent: `T${r.parent}` })
    case "areas":
      return t("live.why.areas", { task, areas: r.areas.join(", ") })
  }
}

export const reasonWords = (r: Reason | undefined): string => (!r ? t("live.why.context") : r.warm ? t("live.why.warm", { why: whyWords(r) }) : whyWords(r))
