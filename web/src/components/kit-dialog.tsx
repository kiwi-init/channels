import { Dialog } from "@base-ui/react/dialog"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import type { ReactNode } from "react"

import { cx } from "@/lib/utils"
import { Icon } from "./icon"

/** A centered modal: alerts, small forms. Escape or a click outside closes it; focus stays inside while open. */
export function Modal({ open, onClose, children, wide, roomy, closeLabel }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; roomy?: boolean; closeLabel?: string }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="no-drag fixed inset-0 z-50 bg-overlay transition-opacity duration-120 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={cx(
            "no-drag fixed top-1/2 left-1/2 z-50 max-h-[88svh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-raised shadow-pop outline-none",
            "transition-[opacity,scale] duration-120 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            roomy ? "max-w-[960px]" : wide ? "max-w-[520px]" : "max-w-[340px]"
          )}
        >
          {children}
          {closeLabel && (
            <Dialog.Close
              aria-label={closeLabel}
              className="absolute top-3 right-3 flex size-(--control) items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-wash hover:text-ink"
            >
              <Icon icon={Cancel01Icon} size={15} />
            </Dialog.Close>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** An alert: title, message, and actions on the right. */
export function Alert({ open, onClose, title, message, children }: { open: boolean; onClose: () => void; title: ReactNode; message?: ReactNode; children: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="px-5 pt-5 pb-4">
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
        {message && (
          <Dialog.Description render={<div />} className="mt-1 text-ui leading-normal text-ink-2">
            {message}
          </Dialog.Description>
        )}
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5">{children}</div>
    </Modal>
  )
}
