import "~/i18n/en/settings"

import { PaintBoardIcon } from "@hugeicons/core-free-icons"
import { useEffect } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { useGlide } from "~/kit/glide"
import { GlyphIcon, Icon, type Glyph, type IconName } from "~/kit/icons"
import { useApp, type Section } from "~/nav"
import { AgentsSection } from "~/settings/agents"
import { ComputersSection } from "~/settings/computers"
import { AboutSection, AccountSection, AppearanceSection } from "~/settings/sections"
import { useSideways } from "~/kit/sideways"
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
  const { nav, go } = useApp()
  useSideways(navRef, nav.section)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return
      go({ to: "back" })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go])

  return (
    <div className="set">
      <header className="top set-top">
        <h1 className="set-top-title">
          <button type="button" className="set-back" title={t("settings.settings.back")} onClick={() => go({ to: "back" })}>
            <Icon name="back" size={14} />
            {t("settings.settings.title")}
          </button>
        </h1>
      </header>
      <nav ref={navRef} className="set-nav" aria-label={t("settings.settings.sections")}>
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
      <main className="set-main">
        <div className="set-body" key={nav.section}>
          <Current section={nav.section} />
        </div>
      </main>
    </div>
  )
}

function Current({ section }: { section: Section }) {
  switch (section) {
    case "account":
      return <AccountSection />
    case "appearance":
      return <AppearanceSection />
    case "computers":
      return <ComputersSection />
    case "agents":
      return <AgentsSection />
    case "about":
      return <AboutSection />
  }
}
