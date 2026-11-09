import "~/styles/start.css"
import type { GoneChannel } from "~/model"
import { useApp } from "~/nav"
import { t } from "~/i18n/i18n"

export function Gone({ gone }: { gone: GoneChannel }) {
  const { go } = useApp()
  return (
    <main className="start-area">
      <div className="start-drag" />
      <div className="start-welcome start-home">
        <h1 className="start-title">{gone.why === "closed" ? t("start.gone.deleted", { name: gone.title }) : t("start.gone.no.longer.in", { name: gone.title })}</h1>
        {gone.why === "closed" && <p className="start-sub">{t("start.gone.nothing.left")}</p>}
        <div className="start-gone-foot">
          <button type="button" className="btn is-primary" onClick={() => go({ to: "home" })}>
            {t("start.gone.back")}
          </button>
        </div>
      </div>
    </main>
  )
}
