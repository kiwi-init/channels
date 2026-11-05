import { useEffect, useState } from "react"

import "~/styles/doc-versions.css"
import { Modal } from "~/kit/bits"
import { announce } from "~/kit/toasts"
import { ago, clock, day } from "~/kit/time"
import { useAppCan } from "~/live/app-can"
import type { Channel, DocVersion } from "~/model"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"

type Listed = { th: string; versions: DocVersion[] } | { th: string; failed: true }

const size = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export function DocVersions({ channel, thread, name, onClose }: { channel: Channel; thread: string; name: string; onClose: () => void }) {
  const { app } = useApp()
  const can = useAppCan("docVersions")
  const th = channel.docs?.[thread] ?? null
  const [listed, setListed] = useState<Listed | null>(null)
  const [picked, setPicked] = useState<DocVersion | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!th || !can) return
    let live = true
    app.actions
      .docVersions(channel.code, th)
      .then((versions) => live && setListed({ th, versions: [...versions].sort((a, b) => b.ts - a.ts) }))
      .catch(() => live && setListed({ th, failed: true }))
    return () => {
      live = false
    }
  }, [app.actions, channel.code, th, can])
  const mine = listed?.th === th ? listed : null
  const restore = async (v: DocVersion): Promise<void> => {
    if (!th) return
    setBusy(true)
    const done = await app.actions.restoreDocVersion(channel.code, thread, th, v.upto).catch(() => false)
    setBusy(false)
    if (!done) return void announce("Couldn't restore that version. Try again.")
    announce(`Restored the doc to ${day(v.ts).toLowerCase()} at ${clock(v.ts)}`)
    onClose()
  }
  const foot = picked ? (
    <>
      <span className="doc-versions-ask">Replace the doc with the version from {ago(picked.ts)} ago? Everyone sees the change.</span>
      <button type="button" className="btn is-small" disabled={busy} onClick={() => setPicked(null)}>
        Cancel
      </button>
      <button type="button" className="btn is-small is-primary" disabled={busy} onClick={() => void restore(picked)}>
        {busy ? "Restoring…" : "Restore"}
      </button>
    </>
  ) : undefined
  const body = !can ? (
    <p className="set-group-hint">Update the app to restore earlier versions.</p>
  ) : !th ? (
    <p className="set-group-hint">This conversation has no doc yet.</p>
  ) : !mine ? (
    <p className="set-group-hint">Loading…</p>
  ) : "failed" in mine ? (
    <p className="set-group-hint">Couldn't load the versions.</p>
  ) : mine.versions.length === 0 ? (
    <p className="set-group-hint">No earlier versions yet. The doc keeps one an hour, up to nine.</p>
  ) : (
    <Group>
      {mine.versions.map((v) => (
        <Row key={v.upto} label={`${day(v.ts)}, ${clock(v.ts)}`} hint={`${ago(v.ts)} ago · ${size(v.bytes)}`}>
          <button type="button" className="btn is-small" disabled={busy} aria-pressed={picked?.upto === v.upto} onClick={() => setPicked(v)}>
            Restore
          </button>
        </Row>
      ))}
    </Group>
  )
  return (
    <Modal onClose={onClose} label="Earlier versions" title="Earlier versions" sub={name} size="narrow" foot={foot}>
      {body}
    </Modal>
  )
}
