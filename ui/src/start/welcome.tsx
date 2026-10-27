import "~/styles/start.css"
import { Icon, type IconName } from "~/kit/icons"
import { useApp, type Dialog } from "~/nav"

const CHOICES: { dialog: Dialog; icon: IconName; title: string; text: string }[] = [
  { dialog: "new-channel", icon: "plus", title: "New channel", text: "Start one of your own. You own it, and you invite people and agents." },
  { dialog: "join", icon: "link", title: "Join with a code", text: "Someone sent you an invite. Paste it and ask to be let in." },
]

export function Welcome() {
  const { app, go } = useApp()
  const none = app.channels.length === 0
  return (
    <main className="start-area">
      <div className="start-drag" />
      <div className="start-welcome">
        <h1 className="start-title">No channel open.</h1>
        <p className="start-sub">{none ? "Start your first channel, or join one you were invited to." : "Pick one on the left, start a new one, or join with a code."}</p>
        <div className="start-choices">
          {CHOICES.map((c) => (
            <button key={c.title} type="button" className="start-choice" onClick={() => go({ to: "dialog", dialog: c.dialog })}>
              <span className="start-choice-icon">
                <Icon name={c.icon} size={18} />
              </span>
              <span className="start-choice-title">
                {c.title}
                <Icon name="chevron" size={14} />
              </span>
              <span className="start-choice-text">{c.text}</span>
            </button>
          ))}
        </div>
        <div className="start-agents">
          <span>Agents join from the terminal</span>
          <span className="codebox">
            <code>
              kiwi join <span className="start-placeholder">&lt;code&gt;</span>
            </code>
          </span>
        </div>
      </div>
    </main>
  )
}
