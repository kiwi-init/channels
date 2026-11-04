import { useEffect, useState } from "react"

import { bytesOf, sizeText } from "~/chat/doc/bytes"
import type { BlockFiles, DocFile, DocImage } from "~/model"
import { useAct } from "~/nav"

type Shot = { state: "loading" } | { state: "gone"; why: string } | { state: "shown"; url: string }

function DocShot({ code, img, open }: { code: string; img: DocImage; open: (url: string, alt: string) => void }) {
  const { actions } = useAct()
  const [shot, setShot] = useState<Shot>({ state: "loading" })
  useEffect(() => {
    let live = true
    actions.docImage(code, img).then(
      (data) => live && setShot(data === null ? { state: "gone", why: `${img.name} is no longer available` } : { state: "shown", url: `data:${img.mime};base64,${data}` }),
      () => live && setShot({ state: "gone", why: `${img.name} didn't load` })
    )
    return () => {
      live = false
    }
  }, [actions, code, img])
  if (shot.state === "shown")
    return (
      <button type="button" className="msg-image" aria-label={`Open ${img.name}`} onClick={() => open(shot.url, img.name)}>
        <img src={shot.url} alt={img.name} />
      </button>
    )
  return (
    <span className="msg-image-spot" title={img.name} role="status">
      {shot.state === "gone" ? shot.why : "Loading image…"}
    </span>
  )
}

function DocFileChip({ code, file }: { code: string; file: DocFile }) {
  const { actions } = useAct()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(sizeText(file.size))
  const download = () => {
    setBusy(true)
    actions
      .docFile(code, file)
      .then((data) => {
        if (data === null) return setSaid("no longer available")
        const url = URL.createObjectURL(new Blob([bytesOf(data)], { type: file.mime || "application/octet-stream" }))
        const a = document.createElement("a")
        a.href = url
        a.download = file.name || "file"
        a.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      })
      .catch(() => setSaid("didn't download"))
      .finally(() => setBusy(false))
  }
  return (
    <button type="button" className="msg-file" disabled={busy} aria-label={`Download ${file.name}`} onClick={download}>
      <span className="msg-file-name">{file.name}</span>
      <span className="msg-file-size">{said}</span>
    </button>
  )
}

export function BlockFilesView({ code, media, open }: { code: string; media: BlockFiles; open: (url: string, alt: string) => void }) {
  return (
    <>
      {media.imgs.length > 0 && (
        <div className="msg-images">
          {media.imgs.map((img) => (
            <DocShot key={img.ref.id} code={code} img={img} open={open} />
          ))}
        </div>
      )}
      {media.files.length > 0 && (
        <div className="msg-files">
          {media.files.map((f) => (
            <DocFileChip key={f.pieces.map((p) => p.id).join("+") || f.name} code={code} file={f} />
          ))}
        </div>
      )}
    </>
  )
}
