import { Suspense } from "react"

import { Count, cx, Heading, IconButton } from "~/kit/bits"
import { useGlide } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { later } from "~/kit/later"
import { useAppPrefs, useGo, useNav, useTiles } from "~/nav"
import { Face } from "~/shell/rail"
import { railItems } from "~/shell/rail-items"
import { t } from "~/i18n/i18n"

const SideCards = later(() => import("~/shell/updates").then((m) => m.SideCards))

export function AppSide() {
  const nav = useNav()
  const go = useGo()
  const tiles = useTiles()
  const prefs = useAppPrefs()
  const onChannel = nav.page === "channel"
  const home = onChannel && nav.channel === null
  const on = onChannel ? nav.channel : null
  const ordered = railItems(tiles, prefs.folders).flatMap((i) => (i.kind === "channel" ? [i.tile] : i.tiles))
  const ref = useGlide<HTMLDivElement>(".side-row.is-on")
  return (
    <div ref={ref} className="side">
      <nav className="side-views" aria-label={t("shell.rail.home")}>
        <ul>
          <li>
            <button type="button" className={cx("side-row", home && "is-on")} aria-current={home ? "page" : undefined} onClick={() => go({ to: "home" })}>
              <span className="side-icon">
                <Icon name="home" />
              </span>
              <span className="side-label">{t("shell.rail.home")}</span>
            </button>
          </li>
        </ul>
      </nav>
      <section aria-label={t("shell.rail.channels")}>
        <Heading action={<IconButton icon="plus" label={t("shell.rail.new.channel")} onClick={() => go({ to: "dialog", dialog: "new-channel" })} />}>{t("shell.rail.channels")}</Heading>
        <ul>
          {ordered.map((tile) => {
            const here = on === tile.code
            return (
              <li key={tile.code}>
                <button
                  type="button"
                  className={cx("side-row", here && "is-on", tile.unread > 0 && !tile.muted && "is-news", tile.muted && "is-muted")}
                  aria-current={here ? "page" : undefined}
                  onClick={() => go({ to: "channel", code: tile.code })}
                >
                  <span className="side-icon side-face">
                    <Face tile={tile} />
                  </span>
                  <span className="side-label">{tile.title}</span>
                  {tile.state === "waiting" ? <span className="side-state">{t("shell.rail.tile.waiting")}</span> : <Count n={tile.needsYou} loud />}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
      <div className="side-foot">
        <Suspense fallback={null}>
          <SideCards />
        </Suspense>
      </div>
    </div>
  )
}
