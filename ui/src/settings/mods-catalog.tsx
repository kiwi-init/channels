import { useEffect, useState } from "react"

import type { CatalogMod } from "../../../desktop/src/bridge.ts"
import { cx } from "~/kit/bits"
import { Modal } from "~/kit/modal"
import { blobUrl } from "~/mods/icon"
import { needWords } from "~/mods/needs"
import { modReads } from "~/mods/served"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"

function CatalogIcon({ mod, size = "md" }: { mod: CatalogMod; size?: "md" | "lg" }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const made = blobUrl(mod.icon ?? null)
    setUrl(made)
    return () => {
      if (made) URL.revokeObjectURL(made)
    }
  }, [mod.icon])
  return url ? (
    <img className={cx("mod-icon", `is-${size}`)} src={url} alt="" draggable={false} onError={() => setUrl(null)} />
  ) : (
    <span className={cx("mod-icon", "is-letter", `is-${size}`)} aria-hidden="true">
      {mod.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function FromKiwi({ installed }: { installed: ReadonlySet<string> }) {
  const { toast } = useApp()
  const [list, setList] = useState<{ mods: CatalogMod[]; why: string | null } | null>(null)
  const [asking, setAsking] = useState<CatalogMod | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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

  const allow = (m: CatalogMod) => {
    const run = modReads().installMod
    if (!run) return
    setBusy(m.name)
    run(m.name, m.needs).then(
      () => {
        setBusy(null)
        setAsking(null)
        setList((now) => now && { ...now, mods: now.mods.map((x) => (x.name === m.name ? { ...x, installed: true } : x)) })
      },
      (e: unknown) => {
        setBusy(null)
        toast(e instanceof Error ? e.message : String(e), "error")
      }
    )
  }

  return (
    <Group title="From Kiwi" hint={list.why ?? "Reviewed by the Kiwi team. Each one installs at the exact copy we checked."}>
      {list.mods.map((m) => {
        const have = m.installed || installed.has(m.name)
        return (
          <div key={m.name} className="set-row mod-row mod-catalog-row">
            <span className="mod-open">
              <CatalogIcon mod={m} />
              <span className="set-row-text">
                <span className="set-row-label">{m.name}</span>
                <span className="set-row-hint">
                  <span className="set-note">{m.does}</span>
                  {m.needs.length > 0 && <span className="set-note">{m.needs.map(needWords).join(" · ")}</span>}
                </span>
              </span>
            </span>
            <div className="set-row-ctl">
              {have ? (
                <span className="set-note">Installed</span>
              ) : (
                <button type="button" className="btn is-quiet is-small" disabled={busy === m.name} onClick={() => setAsking(m)}>
                  Install
                </button>
              )}
            </div>
          </div>
        )
      })}
      {list.why && !list.mods.length && <Row label="The catalog isn't here right now" hint="It comes back when Channels can reach GitHub." />}
      {asking && (
        <Modal
          key={asking.name}
          dismiss="x"
          label={`Install ${asking.name}`}
          title={asking.name}
          sub={`from Kiwi · ${asking.commit.slice(0, 7)}`}
          lead={<CatalogIcon mod={asking} />}
          onClose={() => setAsking(null)}
          foot={
            <>
              <button type="button" className="btn is-quiet" onClick={() => setAsking(null)}>
                Not now
              </button>
              <button type="button" className="btn is-primary" disabled={busy === asking.name} onClick={() => allow(asking)}>
                Allow
              </button>
            </>
          }
        >
          <div className="mod-ask">
            <p>{asking.does}</p>
            {asking.needs.length ? (
              <>
                <p>It runs in its own frame, away from your keys and messages. To work, it asks for:</p>
                <ul className="mod-needs">
                  {asking.needs.map((n) => (
                    <li key={n}>{needWords(n)}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>It runs in its own frame, away from your keys and messages, and asks for nothing more.</p>
            )}
          </div>
        </Modal>
      )}
    </Group>
  )
}
