import "~/styles/mods.css"

import { useEffect, useState } from "react"

import type { ModIcon as IconFile } from "../../../desktop/src/bridge.ts"
import { bytesOf } from "~/chat/doc/bytes"
import { cx } from "~/kit/bits"
import { modReads } from "~/mods/served"

const TYPES: ReadonlySet<string> = new Set(["image/svg+xml", "image/png"])

const loading = new Map<string, { hash: string; url: Promise<string | null> }>()
const ready = new Map<string, string>()

export function blobUrl(icon: IconFile | null): string | null {
  if (!icon || !TYPES.has(icon.type)) return null
  return URL.createObjectURL(new Blob([bytesOf(icon.data)], { type: icon.type }))
}

export function modIconUrl(name: string, hash: string): Promise<string | null> {
  const had = loading.get(name)
  if (had?.hash === hash) return had.url
  const read = modReads().modIcon
  const url = (read ? read(name) : Promise.resolve(null)).then(blobUrl, () => null)
  loading.set(name, { hash, url })
  void url.then((u) => {
    if (u && loading.get(name)?.hash === hash) ready.set(`${name}@${hash}`, u)
  })
  if (had)
    void had.url.then((u) => {
      if (!u) return
      ready.delete(`${name}@${had.hash}`)
      URL.revokeObjectURL(u)
    })
  return url
}

export function ModIcon({ name, icon, size = "md" }: { name: string; icon?: string | undefined; size?: "sm" | "md" | "lg" }) {
  const [shown, setShown] = useState(() => (icon ? { icon, url: ready.get(`${name}@${icon}`) ?? null } : null))
  useEffect(() => {
    if (!icon) return
    let live = true
    void modIconUrl(name, icon).then((url) => live && setShown({ icon, url }))
    return () => {
      live = false
    }
  }, [name, icon])
  const url = icon && shown?.icon === icon ? shown.url : null
  return url ? (
    <img className={cx("mod-icon", `is-${size}`)} src={url} alt="" draggable={false} onError={() => setShown({ icon: icon ?? "", url: null })} />
  ) : (
    <span className={cx("mod-icon", "is-letter", `is-${size}`)} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
