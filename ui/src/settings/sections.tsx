import { useEffect, useState, type ReactNode } from "react"

import { IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { useNow } from "~/kit/time"
import type { TextFont } from "@kiwi/app/theme.ts"
import { personFingerprint } from "@kiwi/core/fingerprint.ts"
import { KEYS_UNSEALED } from "@kiwi/secrets/keys-at-rest.ts"
import type { Account, Channel, ChannelTile, Prefs, Theme, UpdateCheck } from "~/model"
import { updateFound } from "~/settings/update-check"
import { useApp } from "~/nav"
import { Toggle } from "~/kit/bits"
import { Confirm, Group, InlineEdit, Row, Seg } from "~/settings/controls"
import { Themes } from "~/settings/themes"
import { copyText } from "~/kit/toasts"

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
  const { app } = useApp()
  const [leaving, setLeaving] = useState(false)
  const account = app.account
  if (!account) return null
  const { actions } = app
  return (
    <Page title="Account">
      <Group>
        <Row label="Name" tip="Part of your key, so it can't change.">
          <span className="set-value">{account.name}</span>
        </Row>
        <Row label="GitHub" hint={account.githubSignIn ? "You sign in with it." : account.github ? undefined : "Pull requests in tasks, and your picture in channels."}>
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
        {account.githubMove && <Row label="Devices not moved to GitHub" hint={`Still under ${account.githubMove}.`} />}
        {account.githubCode && !account.github && (
          <Row label="GitHub code" hint="Type it on the GitHub page that opened.">
            <code className="set-value set-key">{account.githubCode.code}</code>
            <IconButton
              icon="copy"
              label="Copy the GitHub code"
              onClick={() => {
                copyText(account.githubCode?.code ?? "", "Code copied")
              }}
            />
            <a className="btn is-quiet is-small" href={account.githubCode.url} target="_blank" rel="noreferrer noopener">
              Open GitHub
            </a>
          </Row>
        )}
        {account.key && (
          <Row label="Your key" hint="Others check what you send against it.">
            <code className="set-value set-key">{account.key}</code>
            <IconButton
              icon="copy"
              label="Copy your key"
              onClick={() => {
                copyText(account.key ?? "", "Key copied")
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
      <div className="set-end">
        <button type="button" className="btn is-small set-forget" onClick={() => setLeaving(true)}>
          Sign out
        </button>
      </div>
      <Confirm
        open={leaving}
        title="Sign out of the relay?"
        sub="Your keys, channels and their history stay on this computer."
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
    <Page title="Appearance" lede="On this computer only.">
      <Group>
        <Row label="Mode">
          <Seg label="Mode" value={prefs.theme} options={THEMES} onChange={(theme) => set({ theme })} />
        </Row>
        <Row label="Text size">
          <Seg<number> label="Text size" value={prefs.textSize} options={SIZES} onChange={(textSize) => set({ textSize })} />
        </Row>
        <Row label="Font">
          <Seg label="Font" value={prefs.font} options={FONTS} onChange={(font) => set({ font })} />
        </Row>
        <Row label="Motion">
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
        <Row label="Notify me" hint="Asks: a permission, a question, someone at the door.">
          <Seg label="Notify me" value={prefs.notify} options={NOTIFY} onChange={(notify) => actions.setPrefs({ notify })} />
        </Row>
        <Row label="Sound for mentions and direct messages" tip="A short chime while Channels is in the background.">
          <Toggle label="Sound for mentions and direct messages" on={prefs.mentionSound} onChange={(mentionSound) => actions.setPrefs({ mentionSound })} />
        </Row>
        <Row label={paused ? `Paused until ${clockAt(prefs.snoozeUntil!)}` : "Pause"}>
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
        <Row label="Quiet hours">
          {quiet.on && (
            <span className="set-buttons">
              <input
                className="input is-small"
                type="time"
                aria-label="Quiet hours start"
                value={hhmm(quiet.from)}
                onChange={(e) => actions.setPrefs({ quiet: { ...quiet, from: minutesOf(e.target.value, quiet.from) } })}
              />
              <span className="set-to" aria-hidden="true">
                to
              </span>
              <input
                className="input is-small"
                type="time"
                aria-label="Quiet hours end"
                value={hhmm(quiet.to)}
                onChange={(e) => actions.setPrefs({ quiet: { ...quiet, to: minutesOf(e.target.value, quiet.to) } })}
              />
            </span>
          )}
          <Toggle label="Quiet hours" on={quiet.on} onChange={(on) => actions.setPrefs({ quiet: { ...quiet, on } })} />
        </Row>
      </Group>
      <Group title="Muted" hint={prefs.muted.length ? "They still notify for mentions, direct messages and decisions." : undefined}>
        {prefs.muted.length ? (
          prefs.muted.map((key) => (
            <Row key={key} label={mutedName(app.channels, app.channel, key)}>
              <button type="button" className="btn is-quiet is-small" onClick={() => actions.setMute(key.split("/")[0]!, key.split("/")[1] ?? null, false)}>
                Unmute
              </button>
            </Row>
          ))
        ) : (
          <p className="set-none">Nothing. Mute a channel in its settings, a room in the room list.</p>
        )}
      </Group>
      <Group>
        <Row label="Enter sends" hint={prefs.enterSends ? "Shift Enter starts a new line." : "⌘ Enter sends."}>
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

function VersionRow({ account }: { account: Account }) {
  const { app } = useApp()
  const update = account.update
  const on = <span className="set-mono">{account.version}</span>
  return update?.ready ? (
    <Row label={<New>{update.version} is ready</New>} hint={<>You're on {on}. Channels restarts on the new one.</>}>
      <button type="button" className="btn is-primary is-small" onClick={app.actions.installUpdate}>
        Restart to update
      </button>
    </Row>
  ) : update?.state === "available" ? (
    <Row label={<New>{update.version} is out</New>} hint={update.blocked ? "This copy can't replace itself where it is." : <>You're on {on}.</>}>
      <button type="button" className="btn is-primary is-small" onClick={app.actions.installUpdate}>
        {update.blocked ? "Get it" : "Download and restart"}
      </button>
    </Row>
  ) : update ? (
    <Row
      label={
        <span className="set-state tone-doing">
          <span className="set-state-dot is-doing" aria-hidden="true" />
          Downloading {update.version}
          <span className="set-mono">{update.progress ? ` · ${Math.round(update.progress * 100)}%` : "…"}</span>
        </span>
      }
      hint="You can keep working. We ask before restarting."
    />
  ) : account.desktop ? (
    <CheckUpdates version={account.version} />
  ) : (
    <Row label={<UpToDate />} hint={on} />
  )
}

function New({ children }: { children: ReactNode }) {
  return (
    <span className="set-state">
      <span className="set-state-dot is-new" aria-hidden="true" />
      {children}
    </span>
  )
}

function UpToDate() {
  return (
    <span className="set-state">
      <span className="tone-live">
        <Icon name="check" size={14} />
      </span>
      Up to date
    </span>
  )
}

export function AboutSection() {
  const { app } = useApp()
  const account = app.account
  if (!account) return null
  return (
    <Page title="About" lede="Channels by Kiwi Init.">
      <Group>
        <VersionRow account={account} />
        {account.desktop ? (
          <RelayRow relay={account.relay ?? ""} />
        ) : (
          <Row label="Relay">
            <span className="set-value set-mono">{account.relay ?? "Not connected"}</span>
          </Row>
        )}
      </Group>
      <p className="set-fine">Built on open source software. Each project's license ships inside the app.</p>
    </Page>
  )
}

function CheckUpdates({ version }: { version: string }) {
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
    <Row label={<UpToDate />} hint={<span role="status">{busy ? "Checking…" : result ? updateFound(result) : <span className="set-mono">{version}</span>}</span>}>
      <button type="button" className="btn is-quiet is-small" disabled={busy} onClick={check}>
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
          "Changing it reloads the app."
        )
      }
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
    <Row label="Your key for new devices" hint="A device you add must show this. Anything else isn't you.">
      <code className="set-value set-key">{shown.key}</code>
    </Row>
  )
}
