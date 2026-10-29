import "~/styles/start.css"
import type { GoneChannel } from "~/model"
import { useApp } from "~/nav"

export function Gone({ gone }: { gone: GoneChannel }) {
  const { go } = useApp()
  return (
    <main className="start-area">
      <div className="start-drag" />
      <div className="start-welcome">
        <h1 className="start-title">{gone.why === "closed" ? `${gone.title} was closed.` : `You're no longer in ${gone.title}.`}</h1>
        <p className="start-sub">
          {gone.why === "closed" ? "Its owner closed it, and nothing of it is left on the relay." : "The owner removed you, or you left from another device."} This computer has forgotten it too.
        </p>
        <div className="start-gone-foot">
          <button type="button" className="btn is-primary" onClick={() => go({ to: "home" })}>
            Back to channels
          </button>
        </div>
      </div>
    </main>
  )
}
