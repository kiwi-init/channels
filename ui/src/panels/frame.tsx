import type { ReactNode } from "react"

import { IconButton } from "~/kit/bits"
import { useApp } from "~/nav"

export function PanelHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  const { go } = useApp()
  return (
    <header className="panel-head">
      <h2 className="panel-title">
        {title}
        {sub && <span className="panel-sub"> {sub}</span>}
      </h2>
      {children}
      <IconButton icon="close" label="Close" onClick={() => go({ to: "panel", panel: null })} />
    </header>
  )
}
