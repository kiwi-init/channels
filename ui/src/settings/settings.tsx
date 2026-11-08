import { PaintBoardIcon } from "@hugeicons/core-free-icons"
import { useEffect, useState } from "react"

import { cx } from "~/kit/bits"
import { useGlide } from "~/kit/glide"
import { GlyphIcon, Icon, type Glyph, type IconName } from "~/kit/icons"
import { useApp, type Section } from "~/nav"
import { AgentsSection } from "~/settings/agents"
import { ComputersSection } from "~/settings/computers"
import { PeopleSection } from "~/settings/people"
import { AboutSection, AccountSection, AppearanceSection } from "~/settings/sections"
import type { AdminPerson } from "~/model"
import { useSideways } from "~/kit/sideways"
import { SideCards } from "~/shell/updates"

const SECTIONS: readonly (readonly [Section, string, IconName | Glyph])[] = [
  ["account", "Account", "account"],
  ["appearance", "Appearance", PaintBoardIcon],
  ["computers", "Computers and phones", "devices"],
  ["agents", "Agents", "agent"],
  ["people", "People", "people"],
  ["about", "About", "info"],
]

export function Settings() {
  const navRef = useGlide<HTMLElement>(".side-row.is-on")
  const { app, nav, go } = useApp()
  const [people, setPeople] = useState<AdminPerson[] | null>(null)
  useEffect(() => {
    let live = true
    void app.actions.adminPeople().then((p) => live && setPeople(p))
    return () => {
      live = false
    }
  }, [app.actions])
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
          {SECTIONS.filter(([id]) => id !== "people" || people).map(([id, label, icon]) => {
            const on = nav.section === id
            return (
              <li key={id}>
                <button type="button" className={cx("side-row", on && "is-on")} aria-current={on ? "page" : undefined} onClick={() => go({ to: "settings", section: id })}>
                  <span className="side-icon">{typeof icon === "string" ? <Icon name={icon} /> : <GlyphIcon glyph={icon} />}</span>
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
          <Current section={nav.section} people={people} />
        </div>
      </main>
    </div>
  )
}

function Current({ section, people }: { section: Section; people: AdminPerson[] | null }) {
  switch (section) {
    case "account":
      return <AccountSection />
    case "appearance":
      return <AppearanceSection />
    case "computers":
      return <ComputersSection />
    case "agents":
      return <AgentsSection />
    case "people":
      return people ? <PeopleSection people={people} /> : <AccountSection />
    case "about":
      return <AboutSection />
  }
}
