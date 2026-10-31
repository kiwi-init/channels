import { useEffect } from "react"

import { cx } from "~/kit/bits"
import { useGlide } from "~/kit/glide"
import { Icon, type IconName } from "~/kit/icons"
import { useApp, type Section } from "~/nav"
import { AgentsSection } from "~/settings/agents"
import { ComputersSection } from "~/settings/computers"
import { AboutSection, AccountSection, AppearanceSection, NotificationsSection, UpdatesSection } from "~/settings/sections"
import { useSideways } from "~/kit/sideways"
import { SideCards } from "~/shell/updates"

const SECTIONS: readonly (readonly [Section, string, IconName])[] = [
  ["account", "Account", "account"],
  ["appearance", "Appearance", "paint"],
  ["notifications", "Notifications", "bell"],
  ["computers", "Computers and phones", "devices"],
  ["agents", "Agents", "agent"],
  ["updates", "Updates", "download"],
  ["about", "About", "info"],
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
          <button type="button" className="set-back" title="Back (Esc)" onClick={() => go({ to: "back" })}>
            <Icon name="back" size={14} />
            Settings
          </button>
        </h1>
      </header>
      <nav ref={navRef} className="set-nav" aria-label="Settings sections">
        <ul>
          {SECTIONS.map(([id, label, icon]) => {
            const on = nav.section === id
            return (
              <li key={id}>
                <button type="button" className={cx("side-row", on && "is-on")} aria-current={on ? "page" : undefined} onClick={() => go({ to: "settings", section: id })}>
                  <span className="side-icon">
                    <Icon name={icon} />
                  </span>
                  <span className="side-label">{label}</span>
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
    case "notifications":
      return <NotificationsSection />
    case "computers":
      return <ComputersSection />
    case "agents":
      return <AgentsSection />
    case "updates":
      return <UpdatesSection />
    case "about":
      return <AboutSection />
  }
}
