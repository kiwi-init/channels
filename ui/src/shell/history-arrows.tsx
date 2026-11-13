import "~/i18n/en/shell-later"

import { t } from "~/i18n/i18n"
import { Icon } from "~/kit/icons"
import { keysHint } from "~/kit/keys"
import { historyCan, useGo, useNav } from "~/nav"

export function HistoryArrows() {
  const nav = useNav()
  const go = useGo()
  const can = historyCan(nav)
  return (
    <div className="top-history">
      <button
        type="button"
        className="icon-btn top-history-btn"
        aria-label={t("shell.history.back")}
        title={t("shell.history.back.title", { keys: keysHint("[") })}
        disabled={!can.back}
        onClick={() => go({ to: "history", step: "back" })}
      >
        <Icon name="back" />
      </button>
      <button
        type="button"
        className="icon-btn top-history-btn"
        aria-label={t("shell.history.forward")}
        title={t("shell.history.forward.title", { keys: keysHint("]") })}
        disabled={!can.forward}
        onClick={() => go({ to: "history", step: "forward" })}
      >
        <Icon name="forward" />
      </button>
    </div>
  )
}
