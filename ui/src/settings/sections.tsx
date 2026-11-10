import "~/i18n/en/settings"

import { useEffect, useState, type ReactNode } from "react"

import { cx, IconButton } from "~/kit/bits"
import { Toggle } from "~/kit/form"
import { setDebugOptions, useDebugOptions } from "~/kit/debug"
import { Icon } from "~/kit/icons"
import { LANG_NAMES, LANGS, setLanguage, t, useLanguage, type LangPref } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import type { TextFont } from "@kiwi/app/theme.ts"
import { personFingerprint } from "@kiwi/core/fingerprint.ts"
import { KEYS_UNSEALED } from "@kiwi/secrets/keys-at-rest.ts"
import type { Account, Prefs, Theme, UpdateCheck } from "~/model"
import { updateFound } from "~/settings/update-check"
import { useApp } from "~/nav"
import { Confirm, Group, InlineEdit, Row, Seg } from "~/settings/controls"
import { Themes } from "~/settings/themes"
import { copyText } from "~/kit/toasts"
import { uiVersion } from "~/settings/ui-version"
import { OutsideLink } from "~/kit/outside"
import { UsageBar } from "~/usage/meter"
import { useUsage } from "~/usage/store"
import { canUpgrade, levelOf, planHint, planName, resetsIn, seemsUnlimited, upgradeLabel, usageHint, usedOf } from "~/usage/words"

function hostOf(url: string): string {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).host || url
  } catch {
    // Not a URL yet: the relay refuses it with its own words after the confirm.
    return url
  }
}

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
  const [unlinking, setUnlinking] = useState(false)
  const account = app.account
  if (!account) return null
  const { actions } = app
  return (
    <Page title={t("settings.settings.account")}>
      <Group>
        <Row label={t("settings.sections.name")} tip={t("settings.sections.name.tip")}>
          <span className="set-value">{account.name}</span>
        </Row>
        <Row label="GitHub" hint={account.githubSignIn ? t("settings.sections.github.sign.in") : account.github ? undefined : t("settings.sections.github.why")}>
          {account.githubSignIn && account.github ? (
            <span className="set-value">@{account.github.login}</span>
          ) : account.github ? (
            <>
              <span className="set-value">@{account.github.login}</span>
              <button type="button" className="btn is-quiet is-small" onClick={() => setUnlinking(true)}>
                {t("settings.sections.github.unlink")}
              </button>
              <Confirm
                open={unlinking}
                title={t("settings.sections.github.unlink.ask", { login: account.github.login })}
                sub={t("settings.sections.github.unlink.sub")}
                action={t("settings.sections.github.unlink")}
                onClose={() => setUnlinking(false)}
                onConfirm={() => {
                  setUnlinking(false)
                  actions.unlinkGithub()
                }}
              />
            </>
          ) : (
            <button type="button" className="btn is-primary is-small" onClick={actions.linkGithub}>
              {t("settings.sections.github.link")}
            </button>
          )}
        </Row>
        {account.githubCode && !account.github && (
          <Row label={t("settings.sections.github.code")} hint={t("settings.sections.github.code.hint")}>
            <code className="set-value set-key">{account.githubCode.code}</code>
            <IconButton
              icon="copy"
              label={t("settings.sections.github.code.copy")}
              onClick={() => {
                copyText(account.githubCode?.code ?? "", t("settings.sections.github.code.copied"))
              }}
            />
            <OutsideLink className="btn is-quiet is-small" href={account.githubCode.url}>
              {t("settings.sections.github.open")}
            </OutsideLink>
          </Row>
        )}
        {account.key && (
          <Row label={t("settings.sections.key")} hint={t("settings.sections.key.hint")}>
            <code className="set-value set-key">{account.key}</code>
            <IconButton
              icon="copy"
              label={t("settings.sections.key.copy")}
              onClick={() => {
                copyText(account.key ?? "", t("settings.sections.key.copied"))
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
          {t("settings.sections.sign.out")}
        </button>
      </div>
      <Confirm
        open={leaving}
        title={t("settings.sections.sign.out.title")}
        sub={t("settings.sections.sign.out.sub")}
        action={t("settings.sections.sign.out")}
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
      <Row label={t("settings.sections.plan")} hint={planHint(usage)}>
        <span className="set-value">{planName(usage)}</span>
        {canUpgrade(usage) && usage.upgradeUrl && (
          <OutsideLink className="btn is-primary is-small" href={usage.upgradeUrl}>
            {upgradeLabel(usage)}
          </OutsideLink>
        )}
        {usage.plan === "paid" && usage.billingUrl && (
          <OutsideLink className="btn is-small" href={usage.billingUrl}>
            {t("settings.sections.manage")}
          </OutsideLink>
        )}
      </Row>
      {usage.limit !== null && !seemsUnlimited(usage) && (
        <Row label={t("usage.today")} hint={usageHint(usage, resetsIn(usage.resetsAt, usage.checkedAt))}>
          <span className="set-usage">
            <span className={cx("set-value set-mono", near && "is-near")}>{usedOf(usage)}</span>
            <UsageBar usage={usage} />
          </span>
        </Row>
      )}
      {usage.people && (
        <Row label={t("settings.sections.people")} hint={t("settings.sections.people.hint")}>
          <span className="set-value set-mono">{t("settings.sections.people.count", { total: usage.people.total, today: usage.people.today })}</span>
        </Row>
      )}
    </>
  )
}

const themes = () =>
  [
    ["system", t("settings.sections.theme.system")],
    ["dark", t("settings.sections.theme.dark")],
    ["light", t("settings.sections.theme.light")],
  ] as const satisfies readonly (readonly [Theme, string])[]

const sizes = () =>
  [
    [-1, t("settings.sections.size.small")],
    [0, t("settings.sections.size.default")],
    [1, t("settings.sections.size.large")],
    [2, t("settings.sections.size.larger")],
    [3, t("settings.sections.size.largest")],
  ] as const satisfies readonly (readonly [number, string])[]

const fonts = () =>
  [
    ["system", t("settings.sections.font.system")],
    ["inter", "Inter"],
    ["lato", "Lato"],
    ["atkinson", "Atkinson"],
  ] as const satisfies readonly (readonly [TextFont, string])[]

const motion = () =>
  [
    ["full", t("settings.sections.motion.full")],
    ["reduced", t("settings.sections.motion.reduced")],
  ] as const

export function AppearanceSection() {
  const { app } = useApp()
  const { prefs, actions } = app
  const set = (p: Partial<Prefs>) => actions.setPrefs(p)
  return (
    <Page title={t("settings.settings.appearance")} lede={t("settings.sections.appearance.lede")}>
      <Group>
        <Row label={t("settings.sections.mode")}>
          <Seg label={t("settings.sections.mode")} value={prefs.theme} options={themes()} onChange={(theme) => set({ theme })} />
        </Row>
        <Row label={t("settings.sections.text.size")}>
          <Seg<number> label={t("settings.sections.text.size")} value={prefs.textSize} options={sizes()} onChange={(textSize) => set({ textSize })} />
        </Row>
        <Row label={t("settings.sections.font")}>
          <Seg label={t("settings.sections.font")} value={prefs.font} options={fonts()} onChange={(font) => set({ font })} />
        </Row>
        <Row label={t("settings.sections.motion")}>
          <Seg label={t("settings.sections.motion")} value={prefs.reduceMotion ? "reduced" : "full"} options={motion()} onChange={(m) => set({ reduceMotion: m === "reduced" })} />
        </Row>
        <LanguageRow />
      </Group>
      <Themes />
    </Page>
  )
}

function LanguageRow() {
  const { pref } = useLanguage()
  return (
    <Row label={t("settings.language")}>
      <span className="set-select">
        <select className="input" aria-label={t("settings.language")} value={pref} onChange={(e) => setLanguage(e.target.value as LangPref)}>
          <option value="system">{t("settings.language.system")}</option>
          {LANGS.map((lang) => (
            <option key={lang} value={lang} lang={lang}>
              {LANG_NAMES[lang]}
            </option>
          ))}
        </select>
        <Icon name="down" size={14} />
      </span>
    </Row>
  )
}

function VersionRow({ account }: { account: Account }) {
  const { app } = useApp()
  const update = account.update
  const on = <span className="set-mono">{account.version}</span>
  return update?.ready ? (
    <Row label={<New>{t("settings.sections.update.ready", { version: update.version })}</New>} hint={tr("settings.sections.update.ready.hint", { version: on })}>
      <button type="button" className="btn is-primary is-small" onClick={app.actions.installUpdate}>
        {t("settings.sections.update.restart")}
      </button>
    </Row>
  ) : update?.state === "available" ? (
    <Row
      label={<New>{t("settings.sections.update.out", { version: update.version })}</New>}
      hint={update.blocked ? t("settings.sections.update.blocked") : tr("settings.sections.update.on", { version: on })}
    >
      <button type="button" className="btn is-primary is-small" onClick={app.actions.installUpdate}>
        {update.blocked ? t("settings.sections.update.get") : t("settings.sections.update.download")}
      </button>
    </Row>
  ) : update ? (
    <Row
      label={
        <span className="set-state tone-doing">
          <span className="set-state-dot is-doing" aria-hidden="true" />
          {t("settings.sections.update.downloading", { version: update.version })}
          <span className="set-mono">{update.progress ? ` · ${Math.round(update.progress * 100)}%` : "…"}</span>
        </span>
      }
      hint={t("settings.sections.update.keep.working")}
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
      {t("settings.sections.up.to.date")}
    </span>
  )
}

export function AboutSection() {
  const { app } = useApp()
  const debug = useDebugOptions()
  const account = app.account
  if (!account) return null
  const version = uiVersion()
  return (
    <Page title={t("settings.settings.about")} lede={t("settings.sections.about.lede")}>
      <Group>
        <VersionRow account={account} />
        <Row label={t("settings.sections.interface")} hint={t("settings.sections.interface.hint")}>
          <code className="set-value set-mono">{version}</code>
          <IconButton
            icon="copy"
            label={t("settings.sections.interface.copy")}
            onClick={() => {
              copyText(version, t("settings.sections.interface.copied"))
            }}
          />
        </Row>
        {account.desktop ? (
          <RelayRow relay={account.relay ?? ""} />
        ) : (
          <Row label={t("settings.sections.relay")}>
            <span className="set-value set-mono">{account.relay ?? t("settings.sections.relay.none")}</span>
          </Row>
        )}
      </Group>
      <Group>
        <Row label={t("settings.sections.debug")} hint={t("settings.sections.debug.hint")}>
          <Toggle label={t("settings.sections.debug")} on={debug} onChange={setDebugOptions} />
        </Row>
      </Group>
      <p className="set-fine">{t("settings.sections.licenses")}</p>
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
    <Row label={<UpToDate />} hint={<span role="status">{busy ? t("settings.sections.checking") : result ? updateFound(result) : <span className="set-mono">{version}</span>}</span>}>
      <button type="button" className="btn is-quiet is-small" disabled={busy} onClick={check}>
        {t("settings.sections.check.now")}
      </button>
    </Row>
  )
}

function RelayRow({ relay }: { relay: string }) {
  const { app } = useApp()
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  return (
    <Row
      label={t("settings.sections.relay")}
      hint={
        error ? (
          <span role="alert" className="tone-alert">
            {error.slice(0, 1).toUpperCase() + error.slice(1)}
          </span>
        ) : (
          t("settings.sections.relay.hint")
        )
      }
    >
      <InlineEdit value={relay} label={t("settings.sections.relay")} verb={t("settings.sections.relay.change")} onSave={(url) => (url.trim() === relay ? undefined : setMoving(url))} />
      <Confirm
        open={moving !== null}
        title={t("settings.sections.relay.change.ask", { relay: hostOf(moving ?? "") })}
        sub={t("settings.sections.relay.change.sub")}
        action={t("settings.sections.relay.change.yes")}
        onClose={() => setMoving(null)}
        onConfirm={() => {
          const url = moving
          setMoving(null)
          setError(null)
          if (url) void app.actions.setRelay(url).then(setError)
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
    <Row label={t("settings.sections.login.key")} hint={t("settings.sections.login.key.hint")}>
      <code className="set-value set-key">{shown.key}</code>
    </Row>
  )
}
