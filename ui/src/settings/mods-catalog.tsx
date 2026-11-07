import { useState, useEffect, type ReactNode } from "react"

import type { CatalogMod } from "../../../desktop/src/bridge.ts"
import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { Modal } from "~/kit/modal"
import { blobUrl } from "~/mods/icon"
import { needWords } from "~/mods/needs"
import { modReads } from "~/mods/served"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"

const catalogUrls = new Map<string, string | null>()

function catalogUrl(mod: CatalogMod): string | null {
  if (!mod.icon) return null
  const key = `${mod.name}@${mod.commit}`
  if (!catalogUrls.has(key)) catalogUrls.set(key, blobUrl(mod.icon))
  return catalogUrls.get(key) ?? null
}

export function CatalogIcon({ mod, size = "md" }: { mod: CatalogMod; size?: "md" | "lg" }) {
  const url = catalogUrl(mod)
  const [failed, setFailed] = useState<string | null>(null)
  return url && failed !== url ? (
    <img className={cx("mod-icon", `is-${size}`)} src={url} alt="" draggable={false} onError={() => setFailed(url)} />
  ) : (
    <span className={cx("mod-icon", "is-letter", `is-${size}`)} aria-hidden="true">
      {mod.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function InstallAsk({ mod, busy, onAllow, onClose }: { mod: CatalogMod; busy: boolean; onAllow: () => void; onClose: () => void }) {
  return (
    <Modal
      dismiss="x"
      label={`Install ${mod.name}`}
      title={mod.name}
      sub={`from Kiwi · ${mod.commit.slice(0, 7)}`}
      lead={<CatalogIcon mod={mod} />}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="btn is-quiet" onClick={onClose}>
            Not now
          </button>
          <button type="button" className="btn is-primary" disabled={busy} onClick={onAllow}>
            Allow
          </button>
        </>
      }
    >
      <div className="mod-ask">
        <p>{mod.does}</p>
        {mod.needs.length ? (
          <>
            <p>It runs in its own frame, away from your keys and messages. To work, it asks for:</p>
            <ul className="mod-needs">
              {mod.needs.map((n) => (
                <li key={n}>{needWords(n)}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>It runs in its own frame, away from your keys and messages, and asks for nothing more.</p>
        )}
      </div>
    </Modal>
  )
}

export function useCatalogInstall(onInstalled: (name: string) => void): { ask: (m: CatalogMod) => void; busy: string | null; dialog: ReactNode } {
  const { toast } = useApp()
  const [asking, setAsking] = useState<CatalogMod | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const allow = (m: CatalogMod) => {
    const run = modReads().installMod
    if (!run) return
    setBusy(m.name)
    run(m.name, m.needs).then(
      () => {
        setBusy(null)
        setAsking(null)
        onInstalled(m.name)
      },
      (e: unknown) => {
        setBusy(null)
        toast(e instanceof Error ? e.message : String(e), "error")
      }
    )
  }
  return {
    ask: setAsking,
    busy,
    dialog: asking && <InstallAsk key={asking.name} mod={asking} busy={busy === asking.name} onAllow={() => allow(asking)} onClose={() => setAsking(null)} />,
  }
}

export function FromKiwi({ installed }: { installed: ReadonlySet<string> }) {
  const { go } = useApp()
  const [list, setList] = useState<{ mods: CatalogMod[]; why: string | null } | null>(null)
  const install = useCatalogInstall((name) => setList((now) => now && { ...now, mods: now.mods.map((x) => (x.name === name ? { ...x, installed: true } : x)) }))

  useEffect(() => {
    const read = modReads().modCatalog
    if (!read) return
    let live = true
    void read().then(
      (c) => live && setList(c),
      (e: unknown) => live && setList({ mods: [], why: e instanceof Error ? e.message : String(e) })
    )
    return () => {
      live = false
    }
  }, [])

  if (!list || (!list.mods.length && !list.why)) return null

  return (
    <Group title="From Kiwi" hint={list.why ?? "Reviewed by the Kiwi team. Each one installs at the exact copy we checked."}>
      {list.mods.map((m) => {
        const have = m.installed || installed.has(m.name)
        return (
          <div key={m.name} className="set-row mod-row mod-catalog-row">
            <button type="button" className="mod-open" onClick={() => go({ to: "settings", section: "mods", mod: m.name })}>
              <CatalogIcon mod={m} />
              <span className="set-row-text">
                <span className="set-row-label">{m.name}</span>
                <span className="set-row-hint">
                  <span className="set-note">{m.does}</span>
                  {m.needs.length > 0 && <span className="set-note">{m.needs.map(needWords).join(" · ")}</span>}
                </span>
              </span>
              <span className="mod-open-more">
                <Icon name="chevron" size={14} />
              </span>
            </button>
            <div className="set-row-ctl">
              {have ? (
                <span className="mod-installed">Installed</span>
              ) : (
                <button type="button" className="btn is-quiet is-small" disabled={install.busy === m.name} onClick={() => install.ask(m)}>
                  Install
                </button>
              )}
            </div>
          </div>
        )
      })}
      {list.why && !list.mods.length && <Row label="The catalog isn't here right now" hint="It comes back when Channels can reach GitHub." />}
      {install.dialog}
    </Group>
  )
}
