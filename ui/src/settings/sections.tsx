import { useEffect, useState, type ReactNode } from "react"

import { IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { useNow } from "~/kit/time"
import type { TextFont } from "@kiwi/app/theme.ts"
import { personFingerprint } from "@kiwi/core/fingerprint.ts"
import { KEYS_UNSEALED } from "@kiwi/secrets/keys-at-rest.ts"
import type { Channel, ChannelTile, Prefs, Theme, UpdateCheck } from "~/model"
import { updateFound } from "~/settings/update-check"
import { useApp } from "~/nav"
import { Toggle } from "~/kit/bits"
import { Confirm, Group, InlineEdit, Row, Seg } from "~/settings/controls"
import { Themes } from "~/settings/themes"

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
        <Row label="Name" hint="Shown next to everything you send. It's part of your key, so it stays the one you started with.">
          <span className="set-value">{account.name}</span>
        </Row>
        <Row
          label="GitHub"
          hint={
            account.githubSignIn
              ? "You sign in with it. Your pull requests and their checks show up in tasks, and your GitHub picture is your face in channels."
              : account.github
                ? "Your pull requests and their checks show up in tasks, and your GitHub picture is your face in channels."
                : "Link it to see pull requests and their checks in tasks, and to wear your GitHub picture in channels."
          }
        >
          {account.githubSignIn && account.github ? (
            <span className="set-value">@{account.github.login}</span>
          ) : account.github ? (
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
        {account.githubMove && (
          <Row label="Your devices" hint={`They stay under your earlier sign-in: ${account.githubMove}.`}>
            <span className="set-value">Not moved to GitHub</span>
          </Row>
        )}
        {account.githubCode && !account.github && (
          <Row label="GitHub code" hint="Type it on the GitHub page that opened, then come back.">
            <code className="set-value set-key">{account.githubCode.code}</code>
            <IconButton
              icon="copy"
              label="Copy the GitHub code"
              onClick={() => {
                void navigator.clipboard.writeText(account.githubCode?.code ?? "").then(
                  () => toast("Code copied"),
                  () => toast("Could not copy")
                )
              }}
            />
            <a className="btn is-quiet is-small" href={account.githubCode.url} target="_blank" rel="noreferrer noopener">
              Open GitHub
            </a>
          </Row>
        )}
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
        {account.personPk && <LoginKey pk={account.personPk} />}
      </Group>
      {account.keysUnsealed && (
        <p className="set-fine set-warning" role="note">
          {KEYS_UNSEALED}
        </p>
      )}
      <Group>
        <Row label="Sign out" hint="Signs this computer out of the relay. Your keys and channels stay here.">
          <button type="button" className="btn is-danger is-small" onClick={() => setLeaving(true)}>
            Sign out
          </button>
        </Row>
      </Group>
      <Confirm
        open={leaving}
        title="Sign out?"
        sub="Your keys, channels and their history stay on this computer. Sign in again to pick up where you left off."
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
  [3, "Largest"],
] as const satisfies readonly (readonly [number, string])[]

const FONTS = [
  ["system", "System"],
  ["inter", "Inter"],
  ["lato", "Lato"],
  ["atkinson", "Atkinson"],
] as const satisfies readonly (readonly [TextFont, string])[]

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
        <Row label="Mode" hint="System follows your computer's light or dark setting.">
          <Seg label="Mode" value={prefs.theme} options={THEMES} onChange={(theme) => set({ theme })} />
        </Row>
        <Row label="Text size">
          <Seg<number> label="Text size" value={prefs.textSize} options={SIZES} onChange={(textSize) => set({ textSize })} />
        </Row>
        <Row label="Font" hint="For messages and the app's words. Times, ids and code keep Paper Mono.">
          <Seg label="Font" value={prefs.font} options={FONTS} onChange={(font) => set({ font })} />
        </Row>
        <Row label="Motion" hint="Reduced keeps panels and dialogs still.">
          <Seg label="Motion" value={prefs.reduceMotion ? "reduced" : "full"} options={MOTION} onChange={(m) => set({ reduceMotion: m === "reduced" })} />
        </Row>
      </Group>
      <Themes />
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
  const now = useNow(60_000)
  const paused = prefs.snoozeUntil !== null && prefs.snoozeUntil > now
  const quiet = prefs.quiet
  return (
    <Page title="Notifications" lede="For every channel on this computer.">
      <Group>
        <Row label="Notify me" hint="Asks are things that wait on you: a permission, a question, someone at the door." wide>
          <Seg label="Notify me" value={prefs.notify} options={NOTIFY} onChange={(notify) => actions.setPrefs({ notify })} />
        </Row>
        <Row label="Sound for mentions and direct messages" hint="A short chime when someone mentions you or writes to you directly, while Channels isn't in front.">
          <Toggle label="Sound for mentions and direct messages" on={prefs.mentionSound} onChange={(mentionSound) => actions.setPrefs({ mentionSound })} />
        </Row>
      </Group>
      <Group title="Pause" hint="While paused, nothing notifies or makes a sound. Counts still add up, so you see what you missed.">
        <Row label={paused ? `Paused until ${clockAt(prefs.snoozeUntil!)}` : "Pause notifications"}>
          {paused ? (
            <button type="button" className="btn is-small" onClick={() => actions.snooze(null)}>
              Resume
            </button>
          ) : (
            <span className="set-buttons">
              {SNOOZE.map(([until, label]) => (
                <button key={until} type="button" className="btn is-small" onClick={() => actions.snooze(until)}>
                  {label}
                </button>
              ))}
            </span>
          )}
        </Row>
        <Row label="Quiet hours" hint={quiet.on ? `Every day from ${hhmm(quiet.from)} to ${hhmm(quiet.to)}.` : "Pause every day at the same times."}>
          <Toggle label="Quiet hours" on={quiet.on} onChange={(on) => actions.setPrefs({ quiet: { ...quiet, on } })} />
        </Row>
        {quiet.on && (
          <Row label="From and to">
            <span className="set-buttons">
              <input
                className="input is-small"
                type="time"
                aria-label="Quiet hours start"
                value={hhmm(quiet.from)}
                onChange={(e) => actions.setPrefs({ quiet: { ...quiet, from: minutesOf(e.target.value, quiet.from) } })}
              />
              <input
                className="input is-small"
                type="time"
                aria-label="Quiet hours end"
                value={hhmm(quiet.to)}
                onChange={(e) => actions.setPrefs({ quiet: { ...quiet, to: minutesOf(e.target.value, quiet.to) } })}
              />
            </span>
          </Row>
        )}
      </Group>
      <Group title="Muted" hint="A muted channel or room stays quiet: no notifications, no sound and no count, except when someone mentions you, writes to you directly or a decision is put to you.">
        {prefs.muted.length ? (
          prefs.muted.map((key) => (
            <Row key={key} label={mutedName(app.channels, app.channel, key)}>
              <button type="button" className="btn is-quiet is-small" onClick={() => actions.setMute(key.split("/")[0]!, key.split("/")[1] ?? null, false)}>
                Unmute
              </button>
            </Row>
          ))
        ) : (
          <Row label="Nothing muted" hint="Mute a channel from its settings, or a room from the channel's room list." />
        )}
      </Group>
      <Group>
        <Row label="Enter sends" hint={prefs.enterSends ? "Shift Enter starts a new line." : "Enter starts a new line. ⌘ Enter sends."}>
          <Toggle label="Enter sends" on={prefs.enterSends} onChange={(enterSends) => actions.setPrefs({ enterSends })} />
        </Row>
      </Group>
    </Page>
  )
}

const SNOOZE = [
  ["1h", "1 hour"],
  ["8h", "8 hours"],
  ["tomorrow", "Until tomorrow"],
] as const

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

const minutesOf = (typed: string, fallback: number): number => {
  const m = /^(\d{2}):(\d{2})$/.exec(typed)
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}

const clockAt = (at: number): string => new Date(at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })

function mutedName(tiles: readonly ChannelTile[], open: Channel | null, key: string): string {
  const [code, room] = key.split("/")
  const title = tiles.find((t) => t.code === code)?.title ?? "A channel"
  if (!room) return title
  const name = open?.code === code ? open.rooms.find((r) => r.id === room)?.name : undefined
  return name ? `#${name} in ${title}` : `A room in ${title}`
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
        ) : update?.state === "available" ? (
          <Row
            label={
              <span className="set-state">
                <span className="set-state-dot is-new" aria-hidden="true" />
                {update.version} is out
              </span>
            }
            hint="Channels downloads it, then closes and opens again on the new version."
          >
            <button type="button" className="btn is-primary is-small" onClick={app.actions.installUpdate}>
              Download and restart
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
        {account.desktop && <CheckUpdates />}
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
        {account.desktop ? (
          <RelayRow relay={account.relay ?? ""} />
        ) : (
          <Row label="Relay" hint="Where your channels meet.">
            <span className="set-value">{account.relay ?? "Not connected"}</span>
          </Row>
        )}
      </Group>
      <p className="set-fine">Channels is built on open source software. Each project's license ships inside the app.</p>
    </Page>
  )
}

function CheckUpdates() {
  const { app } = useApp()
  const [result, setResult] = useState<UpdateCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const check = () => {
    setBusy(true)
    void app.actions
      .checkUpdate()
      .then(setResult)
      .finally(() => setBusy(false))
  }
  return (
    <Row label="Check for updates" hint={<span role="status">{busy ? "Checking…" : updateFound(result)}</span>}>
      <button type="button" className="btn is-small" disabled={busy} onClick={check}>
        Check now
      </button>
    </Row>
  )
}

function RelayRow({ relay }: { relay: string }) {
  const { app } = useApp()
  const [error, setError] = useState<string | null>(null)
  return (
    <Row
      label="Relay"
      hint={
        error ? (
          <span role="alert" className="tone-alert">
            {error.slice(0, 1).toUpperCase() + error.slice(1)}
          </span>
        ) : (
          "Where your channels meet. Changing it reloads the app."
        )
      }
      wide
    >
      <InlineEdit
        value={relay}
        label="Relay"
        verb="Change"
        onSave={(url) => {
          setError(null)
          void app.actions.setRelay(url).then(setError)
        }}
      />
    </Row>
  )
}

function LoginKey({ pk }: { pk: string }) {
  const [shown, setShown] = useState<{ pk: string; key: string } | null>(null)
  useEffect(() => {
    let live = true
    void personFingerprint(pk).then((key) => live && setShown({ pk, key }))
    return () => {
      live = false
    }
  }, [pk])
  if (shown?.pk !== pk) return null
  return (
    <Row
      label="Your key for new devices"
      hint="A new computer or phone you sign in, or a computer you add with kiwi login, shows this before it takes you as its person. Anything else means it isn't you."
    >
      <code className="set-value set-key">{shown.key}</code>
    </Row>
  )
}
