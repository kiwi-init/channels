import { useCallback, useEffect, useRef, useState } from "react"

import { t } from "~/i18n/i18n"
import { Icon } from "~/kit/icons"

export type Tone = "info" | "error"

export interface Toast {
  id: number
  text: string
  tone: Tone
}

const SHOWN_MS = 2600
const MOST = 3

const heard = new Set<(text: string, tone: Tone) => void>()

export function announce(text: string, tone: Tone = "info"): void {
  for (const l of heard) l(text, tone)
}

export function copyText(text: string, done = t("kit.toasts.copied")): void {
  if (!navigator.clipboard) return announce(t("kit.toasts.not.copied"), "error")
  void navigator.clipboard.writeText(text).then(
    () => announce(done),
    () => announce(t("kit.toasts.not.copied"), "error")
  )
}

export function kept(list: Toast[], next: Toast): Toast[] {
  const all = [...list.filter((toast) => toast.text !== next.text), next]
  while (all.length > MOST) {
    const info = all.findIndex((toast, i) => toast.tone === "info" && i < all.length - 1)
    all.splice(info < 0 ? 0 : info, 1)
  }
  return all
}

export function useToasts(): [Toast[], (text: string, tone?: Tone) => void, (id: number) => void] {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])
  const push = useCallback(
    (text: string, tone: Tone = "info") => {
      const id = ++next.current
      setToasts((list) => kept(list, { id, text, tone }))
      if (tone === "info") setTimeout(() => dismiss(id), SHOWN_MS)
    },
    [dismiss]
  )
  useEffect(() => {
    heard.add(push)
    return () => void heard.delete(push)
  }, [push])
  return [toasts, push, dismiss]
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) =>
        toast.tone === "error" ? (
          <div key={toast.id} className="toast is-error" role="alert">
            <span>{toast.text}</span>
            <button type="button" className="toast-close" aria-label={t("kit.toasts.dismiss")} onClick={() => onDismiss(toast.id)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : (
          <p key={toast.id} className="toast">
            {toast.text}
          </p>
        )
      )}
    </div>
  )
}
