import { Component, type ReactNode } from "react"

import { rememberChannel } from "@kiwi/app/last-channel.ts"
import { uiFailed } from "@kiwi/app/ui-boot.ts"

import { t } from "~/i18n/i18n"

type Props = {
  children: ReactNode
  resetKey?: string
  whole?: boolean
  panel?: boolean
  quiet?: boolean
  onCrash?: () => void
  onMend?: () => void
}

const SOON_MS = 5_000

export function Crashed({ whole, title, sub, children }: { whole?: boolean; title: string; sub: string; children: ReactNode }) {
  return (
    <div className={whole ? "crash is-whole" : "crash"} role="alert">
      {whole && <div className="crash-drag" />}
      <div className="crash-body">
        <p className="crash-title">{title}</p>
        <p className="crash-sub">{sub}</p>
        <div className="crash-acts">{children}</div>
      </div>
    </div>
  )
}

function startAtHome(): void {
  rememberChannel(null)
  location.reload()
}

export class Boundary extends Component<Props, { failed: boolean; again: boolean }> {
  state = { failed: false, again: false }
  retried = 0
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    if (this.props.whole) uiFailed(error)
    this.props.onCrash?.()
    if (Date.now() - this.retried < SOON_MS) this.setState({ again: true })
  }
  componentDidUpdate(prev: Props) {
    if (prev.resetKey === this.props.resetKey || !this.state.failed) return
    this.retried = 0
    this.setState({ failed: false, again: false })
    this.props.onMend?.()
  }
  retry = () => {
    this.retried = Date.now()
    this.setState({ failed: false, again: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    const { whole, panel, quiet } = this.props
    if (quiet) return null
    if (whole)
      return (
        <Crashed whole title={t("kit.boundary.whole.title")} sub={t("kit.boundary.whole.sub")}>
          <button type="button" className="btn is-primary" onClick={() => location.reload()}>
            {t("kit.boundary.reload")}
          </button>
          <button type="button" className="btn" onClick={startAtHome}>
            {t("kit.boundary.home")}
          </button>
        </Crashed>
      )
    const title = t(panel ? "kit.boundary.panel.title" : "kit.boundary.view.title")
    if (this.state.again)
      return (
        <Crashed title={title} sub={t("kit.boundary.part.sub")}>
          <button type="button" className="btn is-primary" onClick={() => location.reload()}>
            {t("kit.boundary.reload")}
          </button>
        </Crashed>
      )
    return (
      <Crashed title={title} sub={t("kit.boundary.retry.sub")}>
        <button type="button" className="btn is-primary" onClick={this.retry}>
          {t("kit.boundary.retry")}
        </button>
      </Crashed>
    )
  }
}
