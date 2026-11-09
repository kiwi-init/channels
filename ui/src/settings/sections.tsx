import { useEffect, useState, type ReactNode } from "react"

import { cx, IconButton } from "~/kit/bits"
import { Toggle } from "~/kit/form"
import { setDebugOptions, useDebugOptions } from "~/kit/debug"
import { Icon } from "~/kit/icons"
import type { TextFont } from "@kiwi/app/theme.ts"
import { personFingerprint } from "@kiwi/core/fingerprint.ts"
import { KEYS_UNSEALED } from "@kiwi/secrets/keys-at-rest.ts"
import type { Account, Prefs, Theme, UpdateCheck } from "~/model"
import { updateFound } from "~/settings/update-check"
import { useApp } from "~/nav"
import { Confirm, Group, InlineEdit, Row, Seg } from "~/settings/controls"
import { Themes } from "~/settings/themes"
import { copyText } from "~/kit/toasts"
import { UI_VERSION } from "~/settings/ui-version"
import { OutsideLink } from "~/kit/outside"
import { UsageBar } from "~/usage/meter"
import { useUsage } from "~/usage/store"
import { canUpgrade, levelOf, planHint, planName, resetsIn, seemsUnlimited, upgradeLabel, usageHint, usedOf } from "~/usage/words"

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
            <OutsideLink className="btn is-quiet is-small" href={account.githubCode.url}>
              Open GitHub
            </OutsideLink>
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
        <UsageRow />
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

function UsageRow() {
  const { app } = useApp()
  const usage = useUsage(app.actions.myUsage)
  if (!usage) return null
  const near = levelOf(usage) !== "calm"
  return (
    <>
      <Row label="Plan" hint={planHint(usage)}>
        <span className="set-value">{planName(usage)}</span>
        {canUpgrade(usage) && usage.upgradeUrl && (
          <OutsideLink className="btn is-primary is-small" href={usage.upgradeUrl}>
            {upgradeLabel(usage)}
          </OutsideLink>
        )}
        {usage.plan === "paid" && usage.billingUrl && (
          <OutsideLink className="btn is-small" href={usage.billingUrl}>
            Manage
          </OutsideLink>
        )}
      </Row>
      {usage.limit !== null && !seemsUnlimited(usage) && (
        <Row label="Messages today" hint={usageHint(usage, resetsIn(usage.resetsAt, usage.checkedAt))}>
          <span className="set-usage">
            <span className={cx("set-value set-mono", near && "is-near")}>{usedOf(usage)}</span>
            <UsageBar usage={usage} />
          </span>
        </Row>
      )}
      {usage.people && (
        <Row label="People" hint="On this relay. Only its admins see this.">
          <span className="set-value set-mono">{`${usage.people.total.toLocaleString()} · ${usage.people.today.toLocaleString()} active today`}</span>
        </Row>
      )}
    </>
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
  const debug = useDebugOptions()
  const account = app.account
  if (!account) return null
  return (
    <Page title="About" lede="Channels by Kiwi Init.">
      <Group>
        <VersionRow account={account} />
        <Row label="Interface" hint="The look Channels is running. It updates on its own.">
          <code className="set-value set-mono">{UI_VERSION}</code>
          <IconButton
            icon="copy"
            label="Copy the interface version"
            onClick={() => {
              copyText(UI_VERSION, "Version copied")
            }}
          />
        </Row>
        {account.desktop ? (
          <RelayRow relay={account.relay ?? ""} />
        ) : (
          <Row label="Relay">
            <span className="set-value set-mono">{account.relay ?? "Not connected"}</span>
          </Row>
        )}
      </Group>
      <Group>
        <Row label="Debug options" hint="Adds trace tools to the command palette, to record scrolling or typing for a bug report. On this computer only.">
          <Toggle label="Debug options" on={debug} onChange={setDebugOptions} />
        </Row>
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
