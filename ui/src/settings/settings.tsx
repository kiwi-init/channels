import "~/i18n/en/settings"

import { PaintBoardIcon } from "@hugeicons/core-free-icons"
import { useEffect } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { useGlide } from "~/kit/glide"
import { GlyphIcon, Icon, type Glyph, type IconName } from "~/kit/icons"
import { type Section, useGo, useNav } from "~/nav"
import { AgentsPage } from "~/settings/agents"
import { ComputersPage } from "~/settings/computers"
import { AboutPage, AccountPage, AppearancePage } from "~/settings/pages"
import { useSideways } from "~/kit/sideways"
import { Content } from "~/shell/content"
import { Frame } from "~/shell/frame"
import { useTabs } from "~/shell/top-layout"
import { SideCards } from "~/shell/updates"

const SECTIONS: readonly (readonly [Section, Key, IconName | Glyph])[] = [
  ["account", "settings.settings.account", "account"],
  ["appearance", "settings.settings.appearance", PaintBoardIcon],
  ["computers", "settings.settings.computers", "devices"],
  ["agents", "settings.settings.agents", "agent"],
  ["about", "settings.settings.about", "info"],
]

export function Settings() {
  const navRef = useGlide<HTMLElement>(".side-row.is-on")
  const nav = useNav()
  const go = useGo()
  const tabs = useTabs()
  useSideways(navRef, nav.section)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return
      go({ to: "back" })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go])

  const back = (
    <button type="button" className="set-back" title={t("settings.settings.back")} onClick={() => go({ to: "back" })}>
      <Icon name="back" size={14} />
      {t("settings.settings.title")}
    </button>
  )
  return (
    <Frame
      className="set"
      lead={tabs ? undefined : <h1 className="set-lead">{back}</h1>}
      side={
        <nav ref={navRef} className="side set-nav" aria-label={t("settings.settings.sections")}>
          {tabs && <h1 className="set-lead">{back}</h1>}
          <ul>
            {SECTIONS.map(([id, label, icon]) => {
              const on = nav.section === id
              return (
                <li key={id}>
                  <button type="button" className={cx("side-row", on && "is-on")} aria-current={on ? "page" : undefined} onClick={() => go({ to: "settings", section: id })}>
                    <span className="side-icon">{typeof icon === "string" ? <Icon name={icon} /> : <GlyphIcon glyph={icon} />}</span>
                    <span className="side-label">{t(label)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <SideCards />
        </nav>
      }
    >
      <Content>
        <main className="set-main">
          <div className="set-body" key={nav.section}>
            <Current section={nav.section} />
          </div>
        </main>
      </Content>
    </Frame>
  )
}

function Current({ section }: { section: Section }) {
  switch (section) {
    case "account":
      return <AccountPage />
    case "appearance":
      return <AppearancePage />
    case "computers":
      return <ComputersPage />
    case "agents":
      return <AgentsPage />
    case "about":
      return <AboutPage />
  }
}
