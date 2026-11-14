import { sizeText } from "~/chat/doc/bytes"
import type { BlockFiles } from "~/model"

export function BlockFilesSpots({ media }: { media: BlockFiles }) {
  return (
    <>
      {media.imgs.length > 0 && (
        <div className="msg-images">
          {media.imgs.map((img) => (
            <span key={img.ref.id} className="msg-image-spot" title={img.name} />
          ))}
        </div>
      )}
      {media.files.length > 0 && (
        <div className="msg-files">
          {media.files.map((f) => (
            <button key={f.pieces.map((p) => p.id).join("+") || f.name} type="button" className="msg-file" disabled>
              <span className="msg-file-name">{f.name}</span>
              <span className="msg-file-size">{sizeText(f.size)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
