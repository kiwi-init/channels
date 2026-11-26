import "~/i18n/en/modals"
import "~/styles/whatsnew.css"

import { t } from "~/i18n/i18n"
import { Toggle } from "~/kit/form"
import { Modal } from "~/kit/modal"
import { markSeen, setFeature, useFeature } from "~/whatsnew/features"
import type { Note } from "~/whatsnew/notes"

function Item({ note }: { note: Note }) {
  const on = useFeature(note.id)
  return (
    <li className="whatsnew-item">
      <div className="whatsnew-text">
        <h3>{note.title}</h3>
        <p>{note.body}</p>
      </div>
      {note.toggle && <Toggle label={note.title} on={on} onChange={(next) => setFeature(note.id, next)} />}
    </li>
  )
}

export function WhatsNew({ notes, onClose }: { notes: readonly Note[]; onClose: () => void }) {
  const done = () => {
    markSeen(notes.map((n) => n.id))
    onClose()
  }
  return (
    <Modal
      label={t("modals.whatsnew.title")}
      title={t("modals.whatsnew.title")}
      sub={t("modals.whatsnew.sub")}
      onClose={done}
      size="narrow"
      foot={
        <button type="button" className="btn is-primary" autoFocus onClick={done}>
          {t("modals.whatsnew.done")}
        </button>
      }
    >
      <ul className="whatsnew-list">
        {notes.map((n) => (
          <Item key={n.id} note={n} />
        ))}
      </ul>
    </Modal>
  )
}
