import { t } from "~/i18n/i18n"
import { Icon } from "~/kit/icons"
import type { Upload } from "~/model"

export function DropHint({ anyFile = false }: { anyFile?: boolean }) {
  return (
    <div className="compose-drop" aria-hidden="true">
      {t(anyFile ? "chat.attach.drop.files" : "chat.attach.drop")}
    </div>
  )
}

export function AttachedFiles({ files, onRemove, anyFile = false }: { files: readonly Upload[]; onRemove: (i: number) => void; anyFile?: boolean }) {
  if (!files.length) return null
  return (
    <ul className="compose-files" aria-label={t(anyFile ? "chat.attach.attached.files" : "chat.attach.attached")}>
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="compose-file">
          {f.mime.startsWith("image/") ? <img src={`data:${f.mime};base64,${f.data}`} alt={f.name} /> : <span className="compose-file-name">{f.name}</span>}
          <button type="button" className="compose-file-x" aria-label={t("chat.attach.remove.name", { name: f.name })} title={t("chat.attach.remove")} onClick={() => onRemove(i)}>
            <Icon name="close" size={12} />
          </button>
        </li>
      ))}
    </ul>
  )
}
