import { useState } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { ModView } from "../../../desktop/src/bridge.ts"
import { Toggle } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { modsNow, useModsVersion } from "~/mods/host"
import { ModIcon } from "~/mods/icon"
import { needWords } from "~/mods/needs"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { ModDetailsPage } from "~/settings/mod-details"
import { Page } from "~/settings/sections"

const wanted = (m: ModView): boolean => m.state === "on" || m.off === "safe"

const switchable = (m: ModView): boolean => m.state !== "off" || m.off !== undefined

export function ModsSection() {
  useModsVersion()
  const { nav, go, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const mods = modsNow()
  const open = nav.mod ? mods.find((m) => m.name === nav.mod) : undefined
  const flip = (m: ModView, on: boolean) => {
    const b = bridge()
    if (!b || typeof b.setModOn !== "function") return
    setBusy(m.name)
    const done = on && m.state === "asks" ? b.approveMod(m.name, m.needs) : b.setModOn(m.name, on)
    done.then(
      () => setBusy(null),
      (e: unknown) => {
        setBusy(null)
        toast(e instanceof Error ? e.message : String(e), "error")
      }
    )
  }
  if (open) return <ModDetailsPage mod={open} />
  return (
    <Page title="Mods" lede="Each one runs in its own frame, away from your keys and messages.">
      <Group hint={mods.find((m) => m.off === "safe")?.why}>
        {mods.length ? (
          mods.map((m) => (
            <div key={m.name} className="set-row mod-row">
              <button type="button" className="mod-open" onClick={() => go({ to: "settings", section: "mods", mod: m.name })}>
                <ModIcon name={m.name} icon={m.icon} />
                <span className="set-row-text">
                  <span className="set-row-label">{m.version ? `${m.name} ${m.version}` : m.name}</span>
                  <span className="set-row-hint">
                    <span className="set-note">
                      {m.source === "local" ? (
                        "Local"
                      ) : (
                        <>
                          From <span className="set-mono">{m.source}</span>
                        </>
                      )}
                    </span>
                    {m.needs.length > 0 && <span className="set-note">{m.needs.map(needWords).join(" · ")}</span>}
                    {m.why && m.off !== "safe" && m.off !== "you" && <span className="set-note">{m.why}</span>}
                  </span>
                </span>
                <span className="mod-open-more">
                  <Icon name="chevron" size={14} />
                </span>
              </button>
              {switchable(m) && (
                <div className="set-row-ctl">
                  <Toggle on={wanted(m)} label={`Run ${m.name}`} disabled={busy === m.name} onChange={(on) => flip(m, on)} />
                </div>
              )}
            </div>
          ))
        ) : (
          <Row
            label="No mods yet"
            hint={
              <>
                Add one with <span className="set-mono">kiwi mod add</span>.
              </>
            }
          />
        )}
      </Group>
    </Page>
  )
}
