import { lazy, Suspense, useEffect, useState } from "react"

import type { ModDetails, ModView } from "../../../desktop/src/bridge.ts"
import { sizeText } from "~/chat/doc/bytes"
import { Icon } from "~/kit/icons"
import { runningMod } from "~/mods/host"
import { ModIcon } from "~/mods/icon"
import { needWords } from "~/mods/needs"
import { modReads } from "~/mods/served"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { ModSettings } from "~/settings/mod-settings"

const Markdown = lazy(() => import("~/chat/markdown"))

const none = (): void => {}

const date = (at: number): string => new Date(at).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })

function useDetails(mod: ModView): ModDetails | null {
  const [got, setGot] = useState<{ key: string; details: ModDetails | null } | null>(null)
  const key = `${mod.name} ${mod.version ?? ""} ${mod.hash ?? ""} ${mod.icon ?? ""} ${mod.state} ${mod.settingsRev ?? ""}`
  useEffect(() => {
    const read = modReads().modDetails
    if (!read) return
    let live = true
    read(mod.name).then(
      (details) => live && setGot({ key, details }),
      () => live && setGot({ key, details: null })
    )
    return () => {
      live = false
    }
  }, [mod.name, key])
  return got?.details ?? null
}

export function ModDetailsPage({ mod }: { mod: ModView }) {
  const { go } = useApp()
  const d = useDetails(mod)
  const run = runningMod(mod.name)
  const local = mod.source === "local"
  const adds: (readonly [string, string])[] = [
    ...(run?.title ? [["Panel", run.title] as const] : []),
    ...(run?.side ? [["Sidebar section", run.side.title] as const] : []),
    ...(run?.commands ?? []).map((c) => ["Command in ⌘K", c] as const),
    ...(run?.actions ?? []).map((a) => ["In a message's menu", a.title] as const),
  ]
  return (
    <>
      <header className="set-head mod-head">
        <button type="button" className="btn is-quiet is-small mod-head-back" onClick={() => go({ to: "settings", section: "mods" })}>
          <Icon name="back" size={14} />
          Mods
        </button>
        <div className="mod-head-main">
          <ModIcon name={mod.name} icon={mod.icon} size="lg" />
          <div className="mod-head-text">
            <h2 className="set-title">{mod.name}</h2>
            <p className="set-lede">
              {mod.version && <span className="set-mono">{mod.version}</span>}
              {mod.version && d?.author && " · "}
              {d?.author && `by ${d.author}`}
            </p>
          </div>
        </div>
      </header>
      <Group hint={mod.state === "on" ? undefined : mod.why}>
        <Row label="Source">
          <span className="set-value">{local ? "A folder on this computer" : <span className="set-mono">{mod.source}</span>}</span>
        </Row>
        {d?.commit && (
          <Row label="Commit">
            <span className="set-value set-mono" title={d.commit}>
              {d.commit.slice(0, 7)}
            </span>
          </Row>
        )}
        {d?.installed !== null && d?.installed !== undefined && (
          <Row label="Installed">
            <span className="set-value set-mono">{date(d.installed)}</span>
          </Row>
        )}
        {d?.updated !== null && d?.updated !== undefined && (
          <Row label="Updated">
            <span className="set-value set-mono">{date(d.updated)}</span>
          </Row>
        )}
        {d?.bytes !== null && d?.bytes !== undefined && (
          <Row label="Size on disk">
            <span className="set-value set-mono">{sizeText(d.bytes)}</span>
          </Row>
        )}
        {d?.iconWhy && <Row label="Icon" hint={`It shows its first letter: ${d.iconWhy}.`} />}
      </Group>
      {d && d.settings.length > 0 && <ModSettings mod={mod.name} list={d.settings} />}
      <Group title="What it may do">
        {mod.needs.length ? (
          mod.needs.map((n) => <Row key={n} label={needWords(n)} hint={mod.approved.includes(n) ? undefined : "Waits for you to allow it"} />)
        ) : (
          <Row label="Nothing" hint="It asks for no permissions." />
        )}
      </Group>
      {adds.length > 0 && (
        <Group title="What it adds">
          {adds.map(([kind, title], i) => (
            <Row key={i} label={title} hint={kind} />
          ))}
        </Group>
      )}
      {d?.readme && (
        <Group title="README">
          <div className="mod-readme">
            <Suspense fallback={<p className="set-none">{d.readme}</p>}>
              <Markdown markdown={d.readme} onMention={none} onTask={none} onMessage={none} onImage={none} onShown={none} />
            </Suspense>
          </div>
        </Group>
      )}
    </>
  )
}
