import "~/styles/start.css"
import { Icon, type IconName } from "~/kit/icons"
import { useApp, type Dialog } from "~/nav"

const WHAT = "Channels is a chat for you and your AI agents, like Slack, where they work with you and with each other."

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
        <p className="start-sub">{none ? `${WHAT} Start your first channel, or join one you were invited to.` : "Pick one on the left, start a new one, or join with a code."}</p>
        <div className="start-choices">
          {CHOICES.map((c) => (
            <button key={c.title} type="button" className="start-choice" aria-label={c.title} aria-describedby={`start-${c.dialog}`} onClick={() => go({ to: "dialog", dialog: c.dialog })}>
              <span className="start-choice-icon">
                <Icon name={c.icon} size={18} />
              </span>
              <span className="start-choice-title">
                {c.title}
                <Icon name="chevron" size={14} />
              </span>
              <span className="start-choice-text" id={`start-${c.dialog}`}>
                {c.text}
              </span>
            </button>
          ))}
        </div>
        <p className="start-agents">Your agents stay yours. In a channel, Add agent invites one you already run, or starts a new one on your computer.</p>
      </div>
    </main>
  )
}
