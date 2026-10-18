import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { useLayoutEffect, useRef, type ReactNode } from "react"

import { Icon } from "./icon"
import { IconButton } from "./kit"
import { ResizablePanel } from "./ui/panel"

// A thread on the right: the message it started from, every reply under it,
// and a composer that answers in the thread. The main timeline keeps only
// the first message and a "N replies" line.

export function ThreadPanel({ count, children, composer, onClose }: { count: number; children: ReactNode; composer: ReactNode; onClose: () => void }) {
  const scroller = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  // Open at the latest reply, and follow new ones as they come in.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])
  // Remember who opened the thread so Escape can put focus back. The composer takes focus itself.
  useLayoutEffect(() => {
    const prev = document.activeElement
    returnTo.current = prev instanceof HTMLElement ? prev : null
    return () => {
      const back = returnTo.current
      if (back?.isConnected) back.focus()
    }
  }, [])

  // The same canvas as the conversation, a hairline between them; its header is on the window's one
  // header row. Others' bubbles stay Messages grey, as in the main conversation.
  return (
    <ResizablePanel className="flex">
      <aside
        aria-label="Thread"
        className="animate-slide-in flex min-w-0 flex-1 flex-col border-l border-line bg-canvas md:sheet md:border-l-0"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.preventDefault()
          onClose()
        }}
      >
        <header className="drag flex h-(--chrome-h) shrink-0 items-center justify-between px-3">
          <span className="text-ui font-semibold">
            Thread <span className="font-normal text-ink-3">{count === 1 ? "1 reply" : `${count} replies`}</span>
          </span>
          <IconButton label="Close thread" round className="glass size-9 text-ink" onClick={onClose}>
            <Icon icon={Cancel01Icon} size={17} />
          </IconButton>
        </header>
        <div ref={scroller} className="flex-1 overflow-y-auto">
          <div className="px-3 pt-2 pb-4">{children}</div>
        </div>
        {composer}
      </aside>
    </ResizablePanel>
  )
}
