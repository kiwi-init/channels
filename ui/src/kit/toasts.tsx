import { useCallback, useEffect, useRef, useState } from "react"

import { bridge, type KiwiBridge } from "@kiwi/secrets/secrets.ts"

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

export function onAnnounce(l: (text: string, tone: Tone) => void): () => void {
  heard.add(l)
  return () => void heard.delete(l)
}

type AppClipboard = Pick<KiwiBridge, "copyText">

export type CopyOutcome = { kind: "copied"; by: "browser" | "app" } | { kind: "failed"; browser: "no-api" | "refused"; app: "no-bridge" | "refused" }

function appClipboard(): AppClipboard | null {
  const b = bridge()
  return b && typeof b.copyText === "function" ? b : null
}

async function browserWrite(text: string): Promise<"copied" | "no-api" | "refused"> {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") return "no-api"
  try {
    await navigator.clipboard.writeText(text)
    return "copied"
  } catch {
    // The webview refuses a write without a recent user gesture or window focus; the app's own clipboard is tried next.
    return "refused"
  }
}

async function appWrite(text: string, app: AppClipboard | null): Promise<"copied" | "no-bridge" | "refused"> {
  if (!app) return "no-bridge"
  try {
    await app.copyText(text)
    return "copied"
  } catch {
    // An older app without copyText, or a system clipboard that didn't take it: the caller offers a manual copy.
    return "refused"
  }
}

export async function writeClipboard(text: string, app: AppClipboard | null = appClipboard()): Promise<CopyOutcome> {
  const browser = await browserWrite(text)
  if (browser === "copied") return { kind: "copied", by: "browser" }
  const viaApp = await appWrite(text, app)
  if (viaApp === "copied") return { kind: "copied", by: "app" }
  return { kind: "failed", browser, app: viaApp }
}

export async function copyText(text: string, done = t("kit.toasts.copied"), app: AppClipboard | null = appClipboard()): Promise<boolean> {
  const outcome = await writeClipboard(text, app)
  if (outcome.kind === "copied") announce(done)
  else announce(t("kit.toasts.not.copied"), "error")
  return outcome.kind === "copied"
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
  useEffect(() => onAnnounce(push), [push])
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
