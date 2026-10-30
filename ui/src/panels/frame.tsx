import type { ReactNode } from "react"

import { IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { useApp, type Nav } from "~/nav"

const BACK_TO: Record<Nav["tab"], string> = { chat: "the conversation", tasks: "Tasks", agents: "Agents", needs: "Needs you" }

export function PanelHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  const { nav, go } = useApp()
  const close = () => go({ to: "panel", panel: null })
  return (
    <header className="panel-head">
      <button type="button" className="panel-back" onClick={close}>
        <Icon name="back" size={14} />
        Back to {BACK_TO[nav.tab]}
      </button>
      <h2 className="panel-title">
        {title}
        {sub && <span className="panel-sub"> {sub}</span>}
      </h2>
      {children}
      <IconButton icon="close" label="Close" onClick={close} />
    </header>
  )
}
