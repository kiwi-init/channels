import { useState, type ReactNode } from "react"

import { IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Prefs, Theme } from "~/model"
import { useApp } from "~/nav"
import { Toggle } from "~/kit/bits"
import { Confirm, Group, InlineEdit, Row, Seg } from "~/settings/controls"

export function Page({ title, lede, children }: { title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="set-head">
        <h2 className="set-title">{title}</h2>
        {lede && <p className="set-lede">{lede}</p>}
      </header>
      {children}
    </>
  )
}

export function AccountSection() {
  const { app, toast } = useApp()
  const [leaving, setLeaving] = useState(false)
  const account = app.account
  if (!account) return null
  const { actions } = app
  return (
    <Page title="Account" lede="Who you are in every channel.">
      <Group>
        <Row label="Name" hint="Shown next to everything you send.">
          <InlineEdit value={account.name} label="Your name" verb="Change" onSave={actions.setName} />
        </Row>
        <Row label="GitHub" hint={account.github ? "Your pull requests and their checks show up in tasks." : "Link it to see pull requests and their checks in tasks."}>
          {account.github ? (
            <>
              <span className="set-value">@{account.github.login}</span>
              <button type="button" className="btn is-quiet is-small" onClick={actions.unlinkGithub}>
                Unlink
              </button>
            </>
          ) : (
            <button type="button" className="btn is-primary is-small" onClick={actions.linkGithub}>
              Link GitHub
            </button>
          )}
        </Row>
        {account.key && (
          <Row label="Your key" hint="Signs everything you send. Others can check it against this.">
            <code className="set-value set-key">{account.key}</code>
            <IconButton
              icon="copy"
              label="Copy your key"
              onClick={() => {
                void navigator.clipboard.writeText(account.key ?? "").then(
                  () => toast("Key copied"),
                  () => toast("Could not copy")
                )
              }}
            />
          </Row>
        )}
      </Group>
      <Group>
        <Row label="Sign out" hint="Channels on this computer goes back to the first screen.">
          <button type="button" className="btn is-danger is-small" onClick={() => setLeaving(true)}>
            Sign out
          </button>
        </Row>
      </Group>
      <Confirm
        open={leaving}
        title="Sign out?"
        sub="Your channels and their history stay. Sign in again to pick up where you left off."
        action="Sign out"
        onClose={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false)
          actions.signOut()
        }}
      />
    </Page>
  )
}

const THEMES = [
  ["system", "System"],
  ["dark", "Dark"],
  ["light", "Light"],
] as const satisfies readonly (readonly [Theme, string])[]

const SIZES = [
  [-1, "Small"],
  [0, "Default"],
  [1, "Large"],
  [2, "Larger"],
] as const satisfies readonly (readonly [number, string])[]

const MOTION = [
  ["full", "Full"],
  ["reduced", "Reduced"],
] as const

export function AppearanceSection() {
  const { app } = useApp()
  const { prefs, actions } = app
  const set = (p: Partial<Prefs>) => actions.setPrefs(p)
  return (
    <Page title="Appearance" lede="Changes apply right away, on this computer only.">
      <Group>
        <Row label="Theme" hint="System follows your computer's light or dark setting.">
          <Seg label="Theme" value={prefs.theme} options={THEMES} onChange={(theme) => set({ theme })} />
        </Row>
        <Row label="Text size">
          <Seg<number> label="Text size" value={prefs.textSize} options={SIZES} onChange={(textSize) => set({ textSize })} />
        </Row>
        <Row label="Motion" hint="Reduced keeps panels and dialogs still.">
          <Seg label="Motion" value={prefs.reduceMotion ? "reduced" : "full"} options={MOTION} onChange={(m) => set({ reduceMotion: m === "reduced" })} />
        </Row>
      </Group>
    </Page>
  )
}

const NOTIFY = [
  ["all", "Everything"],
  ["mentions", "Mentions and asks"],
  ["none", "Nothing"],
] as const satisfies readonly (readonly [Prefs["notify"], string])[]

export function NotificationsSection() {
  const { app } = useApp()
  const { prefs, actions } = app
  return (
    <Page title="Notifications" lede="For every channel on this computer.">
      <Group>
        <Row label="Notify me" hint="Asks are things that wait on you: a permission, a question, someone at the door." wide>
          <Seg label="Notify me" value={prefs.notify} options={NOTIFY} onChange={(notify) => actions.setPrefs({ notify })} />
        </Row>
        <Row label="Sound" hint="A short tone when a notification arrives.">
          <Toggle label="Sound" on={prefs.sound} onChange={(sound) => actions.setPrefs({ sound })} />
        </Row>
        <Row label="Enter sends" hint={prefs.enterSends ? "Shift Enter starts a new line." : "Enter starts a new line. ⌘ Enter sends."}>
          <Toggle label="Enter sends" on={prefs.enterSends} onChange={(enterSends) => actions.setPrefs({ enterSends })} />
        </Row>
      </Group>
    </Page>
  )
}

export function UpdatesSection() {
  const { app } = useApp()
  const account = app.account
  if (!account) return null
  const update = account.update
  return (
    <Page title="Updates" lede="Channels checks for a new version on its own.">
      <Group>
        <Row label="This version">
          <span className="set-value">{account.version}</span>
        </Row>
        {update?.ready ? (
          <Row
            label={
              <span className="set-state">
                <span className="set-state-dot is-new" aria-hidden="true" />
                {update.version} is ready
              </span>
            }
            hint="Channels closes and opens again on the new version."
          >
            <button type="button" className="btn is-primary is-small" onClick={app.actions.installUpdate}>
              Restart to update
            </button>
          </Row>
        ) : update ? (
          <Row
            label={
              <span className="set-state tone-doing">
                <span className="set-state-dot is-doing" aria-hidden="true" />
                Downloading {update.version}…
              </span>
            }
            hint="You can keep working. We ask before restarting."
          />
        ) : (
          <Row
            label={
              <span className="set-state">
                <span className="tone-live">
                  <Icon name="check" size={14} />
                </span>
                Up to date
              </span>
            }
          />
        )}
      </Group>
    </Page>
  )
}

export function AboutSection() {
  const { app } = useApp()
  const account = app.account
  if (!account) return null
  return (
    <Page title="About" lede="Channels by Kiwi Init.">
      <Group>
        <Row label="Version">
          <span className="set-value">{account.version}</span>
        </Row>
        <Row label="Relay" hint="Where your channels meet.">
          <span className="set-value">{account.relay ?? "Not connected"}</span>
        </Row>
      </Group>
      <p className="set-fine">Channels is built on open source software. Each project's license ships inside the app.</p>
    </Page>
  )
}
