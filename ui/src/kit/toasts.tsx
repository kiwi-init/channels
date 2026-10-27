import { useCallback, useEffect, useRef, useState } from "react"

interface Toast {
  id: number
  text: string
}

const heard = new Set<(text: string) => void>()

export function announce(text: string): void {
  for (const l of heard) l(text)
}

export function useToasts(): [Toast[], (text: string) => void] {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(0)
  const push = useCallback((text: string) => {
    const id = ++next.current
    setToasts((list) => [...list.filter((t) => t.text !== text), { id, text }].slice(-3))
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2600)
  }, [])
  useEffect(() => {
    heard.add(push)
    return () => void heard.delete(push)
  }, [push])
  return [toasts, push]
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <p key={t.id} className="toast">
          {t.text}
        </p>
      ))}
    </div>
  )
}
