import { Component, type ReactNode } from "react"

import { uiFailed } from "@/lib/ui-boot"

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
          <p className="crash-title">{whole ? "Channels hit a problem" : panel ? "This panel hit a problem" : "This view hit a problem"}</p>
          <p className="crash-sub">
            {whole ? "Nothing was lost: your channels and keys are still here. Reload to carry on." : "Nothing was lost. Reload to try again; the rest of Channels still works."}
          </p>
          <button type="button" className="btn is-primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
