import "~/i18n/en/modals"
import { useEffect, useState } from "react"

import "~/styles/doc-versions.css"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Modal } from "~/kit/modal"
import { announce } from "~/kit/toasts"
import { ago, clock, day } from "~/kit/time"
import { useAppCan } from "~/live/app-can"
import type { Channel, DocVersion } from "~/model"
import { useActions } from "~/nav"
import { Group, Row } from "~/settings/controls"

type Listed = { th: string; versions: DocVersion[] } | { th: string; failed: true }

const size = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export function DocVersions({ channel, thread, name, onClose }: { channel: Channel; thread: string; name: string; onClose: () => void }) {
  const actions = useActions()
  const can = useAppCan("docVersions")
  const th = channel.docs?.[thread] ?? null
  const [listed, setListed] = useState<Listed | null>(null)
  const [picked, setPicked] = useState<DocVersion | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!th || !can) return
    let live = true
    actions
      .docVersions(channel.code, th)
      .then((versions) => live && setListed({ th, versions: [...versions].sort((a, b) => b.ts - a.ts) }))
      .catch(() => live && setListed({ th, failed: true }))
    return () => {
      live = false
    }
  }, [actions, channel.code, th, can])
  const mine = listed?.th === th ? listed : null
  const restore = async (v: DocVersion): Promise<void> => {
    if (!th) return
    setBusy(true)
    const done = await actions.restoreDocVersion(channel.code, thread, th, v.upto).catch(() => false)
    setBusy(false)
    if (!done) return void announce(t("modals.doc.versions.restore.failed"))
    announce(t("modals.doc.versions.restored", { day: day(v.ts).toLowerCase(), time: clock(v.ts) }))
    onClose()
  }
  const foot = picked ? (
    <>
      <span className="doc-versions-ask">{t("modals.doc.versions.replace.ask", { time: ago(picked.ts) })}</span>
      <button type="button" className="btn is-small" disabled={busy} onClick={() => setPicked(null)}>
        {t("modals.doc.versions.cancel")}
      </button>
      <button type="button" className="btn is-small is-primary" disabled={busy} onClick={() => void restore(picked)}>
        {busy ? t("modals.doc.versions.restoring") : t("modals.doc.versions.restore")}
      </button>
    </>
  ) : undefined
  const body = !can ? (
    <p className="set-group-hint">{t("modals.doc.versions.update.app")}</p>
  ) : !th ? (
    <p className="set-group-hint">{t("modals.doc.versions.no.doc")}</p>
  ) : !mine ? (
    <p className="set-group-hint">{t("modals.doc.versions.loading")}</p>
  ) : "failed" in mine ? (
    <p className="set-group-hint">{t("modals.doc.versions.load.failed")}</p>
  ) : mine.versions.length === 0 ? (
    <p className="set-group-hint">{t("modals.doc.versions.none")}</p>
  ) : (
    <div className={cx("doc-versions", picked && "is-picking")}>
      <Group>
        {mine.versions.map((v) => (
          <Row key={v.upto} label={t("modals.doc.versions.row.label", { day: day(v.ts), time: clock(v.ts) })} hint={t("modals.doc.versions.row.hint", { time: ago(v.ts), size: size(v.bytes) })}>
            <button type="button" className="btn is-small" disabled={busy} aria-pressed={picked?.upto === v.upto} onClick={() => setPicked(v)}>
              {t("modals.doc.versions.restore")}
            </button>
          </Row>
        ))}
      </Group>
    </div>
  )
  return (
    <Modal dismiss="outside" onClose={onClose} label={t("modals.doc.versions.title")} title={t("modals.doc.versions.title")} sub={name} size="narrow" foot={foot}>
      {body}
    </Modal>
  )
}
