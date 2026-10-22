import { ArrowLeft01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { useLayoutEffect, useRef, type ReactNode } from "react"

import { Icon } from "./icon"
import { IconButton } from "./kit"
import { ResizablePanel } from "./ui/panel"

// The channel's tasks on the right, in the same shell as a thread: the list, and a task opened from
// it in its place, with a way back. An open task reads like a thread too: its details where a
// thread's first message is, its conversation under them, and a composer that talks in it.

export function TasksPanel({
  title,
  onBack,
  backLabel = "All tasks",
  onClose,
  follow,
  children,
  composer,
}: {
  /** What the header reads: Tasks and how many are open, or the open task's number. */
  title: ReactNode
  /** While a task is open: back to the list. */
  onBack?: () => void
  backLabel?: string
  onClose: () => void
  /** The panel keeps to its foot as this changes (a task opens, a message lands there); null keeps to the top, for the list. */
  follow: string | null
  children: ReactNode
  composer?: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const self = useRef<HTMLElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = follow === null ? 0 : el.scrollHeight
    // Going back to the list (or to a task) takes away the button that had focus: keep it here, for Escape.
    if (document.activeElement === document.body) self.current?.focus({ preventScroll: true })
  }, [follow])
  // Remember who opened the panel so Escape can put focus back, and take focus so Escape reaches it.
  useLayoutEffect(() => {
    const prev = document.activeElement
    returnTo.current = prev instanceof HTMLElement ? prev : null
    self.current?.focus({ preventScroll: true })
    return () => {
      const back = returnTo.current
      if (back?.isConnected) back.focus()
    }
  }, [])

  return (
    <ResizablePanel className="flex">
      <aside
        ref={self}
        tabIndex={-1}
        aria-label="Tasks"
        className="flex min-w-0 flex-1 flex-col border-l border-line bg-canvas outline-none focus-visible:outline-none md:sheet md:border-l-0"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.preventDefault()
          onClose()
        }}
      >
        <header className="drag flex h-(--chrome-h) shrink-0 items-center gap-2 px-3">
          {onBack && (
            <IconButton label={backLabel} round className="glass size-9 text-ink" onClick={onBack}>
              <Icon icon={ArrowLeft01Icon} size={18} />
            </IconButton>
          )}
          <span className="min-w-0 flex-1 truncate text-ui font-semibold">{title}</span>
          <IconButton label="Close tasks" round className="glass size-9 text-ink" onClick={onClose}>
            <Icon icon={Cancel01Icon} size={17} />
          </IconButton>
        </header>
        <div ref={scroller} className="flex flex-1 flex-col overflow-y-auto">
          {children}
        </div>
        {composer}
      </aside>
    </ResizablePanel>
  )
}
