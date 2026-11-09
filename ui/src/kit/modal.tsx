import "~/i18n/en/github-later"
import { useEffect, useRef, type ReactNode } from "react"

import { t } from "~/i18n/i18n"
import { cx, IconButton } from "~/kit/bits"

type ModalSize = "narrow" | "wide"

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export type ModalDismiss = "x" | "outside"

export function Modal({
  open = true,
  onClose,
  dismiss,
  label,
  title,
  sub,
  lead,
  tabs,
  foot,
  size,
  className,
  children,
}: {
  open?: boolean
  onClose: () => void
  dismiss: ModalDismiss
  label: string
  title: ReactNode
  sub?: ReactNode
  lead?: ReactNode
  tabs?: ReactNode
  foot?: ReactNode
  size?: ModalSize
  className?: string
  children?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const wanted = useRef(open)
  const pressed = useRef<EventTarget | null>(null)
  useEffect(() => {
    wanted.current = open
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      ;(el.querySelector<HTMLElement>("[autofocus]") ?? el).focus()
    }
    if (!open && el.open) el.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className={cx("modal", size && `is-${size}`, !!tabs && "has-tabs", !children && "is-bare")}
      aria-label={label}
      onClose={() => {
        if (wanted.current) onClose()
      }}
      onPointerDown={(e) => {
        pressed.current = e.target
      }}
      onClick={(e) => {
        const started = pressed.current
        pressed.current = null
        if (dismiss === "outside" && e.target === e.currentTarget && started === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab" || e.defaultPrevented) return
        const stops = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (!stops.length) return
        e.preventDefault()
        const at = stops.indexOf(document.activeElement as HTMLElement)
        const next = at < 0 ? (e.shiftKey ? stops.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length
        stops[next]?.focus()
      }}
    >
      {open && (
        <>
          <header className={cx("modal-head", !!lead && "has-lead")}>
            {lead && <span className="modal-lead">{lead}</span>}
            <div className="modal-title">
              <h2>{title}</h2>
              {sub && <p>{sub}</p>}
            </div>
            <IconButton icon="close" label={t("kit.modal.close")} onClick={onClose} />
            {tabs && <div className="modal-tabs">{tabs}</div>}
          </header>
          {children && <div className={cx("modal-body", className)}>{children}</div>}
          {foot && <footer className="modal-foot">{foot}</footer>}
        </>
      )}
    </dialog>
  )
}
