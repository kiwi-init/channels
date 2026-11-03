import "~/styles/start.css"
import { Icon } from "~/kit/icons"
import { useApp } from "~/nav"

export function Welcome() {
  const { app, go } = useApp()
  const none = app.channels.length === 0
  return (
    <main className="start-area">
      <div className="start-drag" />
      <div className="start-welcome start-home">
        <h1 className="start-title">{none ? "No channels yet" : "No channel open"}</h1>
        <div className="start-choices">
          <button type="button" className="btn is-primary" onClick={() => go({ to: "dialog", dialog: "new-channel" })}>
            <Icon name="plus" size={14} />
            New channel
          </button>
          <button type="button" className="btn" onClick={() => go({ to: "dialog", dialog: "join" })}>
            <Icon name="link" size={14} />
            Join with a code
          </button>
        </div>
      </div>
    </main>
  )
}
