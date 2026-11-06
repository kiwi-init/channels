import { useState } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { ModView } from "../../../desktop/src/bridge.ts"
import { Toggle } from "~/kit/form"
import { modsNow, useModsVersion } from "~/mods/host"
import { needWords } from "~/mods/needs"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { Page } from "~/settings/sections"

const wanted = (m: ModView): boolean => m.state === "on" || m.off === "safe"

const switchable = (m: ModView): boolean => m.state !== "off" || m.off !== undefined

export function ModsSection() {
  useModsVersion()
  const { toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const mods = modsNow()
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
  return (
    <Page title="Mods" lede="Each one runs in its own frame, away from your keys and messages.">
      <Group hint={mods.find((m) => m.off === "safe")?.why}>
        {mods.length ? (
          mods.map((m) => (
            <Row
              key={m.name}
              label={m.version ? `${m.name} ${m.version}` : m.name}
              hint={
                <>
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
                </>
              }
            >
              {switchable(m) && <Toggle on={wanted(m)} label={`Run ${m.name}`} disabled={busy === m.name} onChange={(on) => flip(m, on)} />}
            </Row>
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
