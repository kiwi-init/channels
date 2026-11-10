import "~/i18n/en/github-later"
import type { ReactNode } from "react"

import { t } from "~/i18n/i18n"
import { autofocus } from "~/kit/bits"
import { Modal } from "~/kit/modal"

export function Confirm({
  open,
  title,
  sub,
  action,
  keep,
  ready = true,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean
  title: string
  sub: string
  action: string
  keep?: string | undefined
  ready?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}) {
  return (
    <Modal open={open} onClose={onClose} label={title} title={title} sub={sub}>
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onConfirm()
        }}
      >
        {children}
        <div className="modal-foot">
          <button type="button" className="btn is-quiet" onClick={onClose} ref={autofocus}>
            {keep ?? t("kit.context.menu.cancel")}
          </button>
          <button type="submit" className="btn is-danger" disabled={!ready}>
            {action}
          </button>
        </div>
      </form>
    </Modal>
  )
}
