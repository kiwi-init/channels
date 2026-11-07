import { lazy, Suspense, useEffect, useState } from "react"

import type { CatalogMod, ModShot, ModStorePage } from "../../../desktop/src/bridge.ts"
import { bytesOf } from "~/chat/doc/bytes"
import { Icon } from "~/kit/icons"
import { needWords } from "~/mods/needs"
import { modReads } from "~/mods/served"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { CatalogIcon, useCatalogInstall } from "~/settings/mods-catalog"

const Markdown = lazy(() => import("~/chat/markdown"))

const none = (): void => {}

const failed = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const SHOT_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"])
const shotUrls = new Map<string, string | null>()

function shotUrl(commit: string, shot: ModShot): string | null {
  const key = `${commit}/${shot.name}`
  if (!shotUrls.has(key)) shotUrls.set(key, SHOT_TYPES.has(shot.type) ? URL.createObjectURL(new Blob([bytesOf(shot.data)], { type: shot.type })) : null)
  return shotUrls.get(key) ?? null
}

function Shots({ page, commit }: { page: ModStorePage; commit: string }) {
  const shown = page.shots.flatMap((s) => {
    const url = shotUrl(commit, s)
    return url ? [{ name: s.name, url }] : []
  })
  const left = page.skipped.filter((s) => s.name.startsWith("media/"))
  if (!shown.length && !left.length) return null
  return (
    <Group title="Screenshots" hint={left.length ? left.map((s) => `${s.name.slice(6)}: ${s.why}`).join(" · ") : undefined}>
      {shown.length > 0 && (
        <div className="mod-shots">
          {shown.map((u) => (
            <img key={u.name} className="mod-shot" src={u.url} alt={`${page.name}: ${u.name.slice(6)}`} draggable={false} />
          ))}
        </div>
      )}
    </Group>
  )
}

export default function ModStore({ name }: { name: string }) {
  const { go } = useApp()
  const [entry, setEntry] = useState<CatalogMod | null | undefined>(undefined)
  const [page, setPage] = useState<ModStorePage | null>(null)
  const [why, setWhy] = useState<string | null>(null)
  const [have, setHave] = useState(false)
  const install = useCatalogInstall(() => setHave(true))

  useEffect(() => {
    const reads = modReads()
    let live = true
    void reads.modCatalog?.().then(
      (c) => live && setEntry(c.mods.find((m) => m.name === name) ?? null),
      (e: unknown) => live && (setEntry(null), setWhy(failed(e)))
    )
    void reads.modStorePage?.(name).then(
      (p) => live && setPage(p),
      (e: unknown) => live && setWhy(failed(e))
    )
    return () => {
      live = false
    }
  }, [name])

  const back = (
    <button type="button" className="btn is-quiet is-small mod-head-back" onClick={() => go({ to: "settings", section: "mods" })}>
      <Icon name="back" size={14} />
      Mods
    </button>
  )
  if (entry === undefined) return <header className="set-head mod-head">{back}</header>
  if (entry === null)
    return (
      <>
        <header className="set-head mod-head">
          {back}
          <h2 className="set-title">{name}</h2>
          <p className="set-lede">{why ? `Channels couldn't read From Kiwi: ${why}` : "From Kiwi doesn't list it."}</p>
        </header>
      </>
    )
  const installed = entry.installed || have
  const meta = [page?.version ? <span className="set-mono">{page.version}</span> : null, entry.author ? `by ${entry.author}` : null, entry.category ?? null].filter((x) => x !== null)
  return (
    <>
      <header className="set-head mod-head">
        {back}
        <div className="mod-head-main">
          <CatalogIcon mod={entry} size="lg" />
          <div className="mod-head-text">
            <h2 className="set-title">{entry.name}</h2>
            {meta.length > 0 && (
              <p className="set-lede">
                {meta.map((m, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    {m}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="mod-head-act">
            {installed ? (
              <span className="mod-installed">Installed</span>
            ) : (
              <button type="button" className="btn is-primary is-small" disabled={install.busy === entry.name} onClick={() => install.ask(entry)}>
                Install
              </button>
            )}
          </div>
        </div>
        <p className="set-lede mod-store-does">{entry.does}</p>
      </header>
      {page && <Shots page={page} commit={entry.commit} />}
      <Group title="What it may do">{entry.needs.length ? entry.needs.map((n) => <Row key={n} label={needWords(n)} />) : <Row label="Nothing" hint="It asks for no permissions." />}</Group>
      <Group hint={why && !page ? `Channels couldn't read the rest of its page: ${why}` : undefined}>
        <Row label="Source">
          <span className="set-value set-mono">{entry.source}</span>
        </Row>
        <Row label="Reviewed copy">
          <span className="set-value set-mono" title={entry.commit}>
            {entry.commit.slice(0, 7)}
          </span>
        </Row>
      </Group>
      {page?.readme && (
        <Group title="README">
          <div className="mod-readme">
            <Suspense fallback={<p className="set-none">{page.readme}</p>}>
              <Markdown markdown={page.readme} onMention={none} onTask={none} onMessage={none} onImage={none} onShown={none} />
            </Suspense>
          </div>
        </Group>
      )}
      {install.dialog}
    </>
  )
}
