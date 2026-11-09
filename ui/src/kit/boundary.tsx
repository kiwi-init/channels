import { Component, type ReactNode } from "react"

import { uiFailed } from "@kiwi/app/ui-boot.ts"

import { t } from "~/i18n/i18n"

type Props = { children: ReactNode; resetKey?: string; whole?: boolean; panel?: boolean }

export class Boundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    if (this.props.whole) uiFailed(error)
  }
  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    const { whole, panel } = this.props
    return (
      <div className={whole ? "crash is-whole" : "crash"} role="alert">
        {whole && <div className="crash-drag" />}
        <div className="crash-body">
          <p className="crash-title">{t(whole ? "kit.boundary.whole.title" : panel ? "kit.boundary.panel.title" : "kit.boundary.view.title")}</p>
          <p className="crash-sub">{t(whole ? "kit.boundary.whole.sub" : "kit.boundary.part.sub")}</p>
          <button type="button" className="btn is-primary" onClick={() => location.reload()}>
            {t("kit.boundary.reload")}
          </button>
        </div>
      </div>
    )
  }
}
