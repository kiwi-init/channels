import "~/i18n/en/settings"

import { setLayout, useLayout, type Layout } from "@kiwi/app/layout.ts"
import type { TextFont } from "@kiwi/app/theme.ts"
import { personFingerprint } from "@kiwi/core/fingerprint.ts"
import { KEYS_UNSEALED } from "@kiwi/secrets/keys-at-rest.ts"
import { Suspense, useEffect, useState, type ReactNode } from "react"

import { LANG_NAMES, LANGS, setLanguage, t, useLanguage, type LangPref } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { setDebugOptions, useDebugOptions } from "~/kit/debug"
import { Details, failedToast, failure, type Failure } from "~/kit/failed"
import { Icon } from "~/kit/icons"
import { copyText } from "~/kit/toasts"
import type { Account, Prefs, Theme, UpdateCheck } from "~/model"
import { useApp } from "~/nav"
import { Confirm, InlineEdit } from "~/settings/controls"
import { acts, choices, code, esc, field, fine, join, link, main, note, row, say, Sheet, toggle, words, type Acts } from "~/settings/sheet"
import { Themes } from "~/settings/themes"
import { uiVersion } from "~/settings/ui-version"
import { updateFound } from "~/settings/update-check"
import { UsageBar } from "~/usage/meter"
import { useUsage, type SeenUsage } from "~/usage/store"
import { canUpgrade, levelOf, planHint, planName, resetsIn, seemsUnlimited, upgradeLabel, usageHint, usedOf } from "~/usage/words"

function hostOf(url: string): string {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).host || url
  } catch {
    // Not a URL yet: the relay refuses it with its own words after the confirm.
    return url
  }
}

function useFingerprint(pk: string | undefined): string | null {
  const [shown, setShown] = useState<{ pk: string; key: string } | null>(null)
  useEffect(() => {
    if (!pk) return
    let live = true
    void personFingerprint(pk).then((key) => live && setShown({ pk, key }))
    return () => {
      live = false
    }
  }, [pk])
  return pk && shown?.pk === pk ? shown.key : null
}

function usageRows(usage: SeenUsage | null): string[] {
  if (!usage) return []
  const plan = [
    esc(planName(usage)),
    canUpgrade(usage) && usage.upgradeUrl ? main(link(upgradeLabel(usage), usage.upgradeUrl)) : "",
    usage.plan === "paid" && usage.billingUrl ? link(t("settings.sections.manage"), usage.billingUrl) : "",
  ]
  return [
    row({ label: t("settings.sections.plan"), hint: esc(planHint(usage)), line: plan.filter(Boolean).join(" ") }),
    usage.limit !== null && !seemsUnlimited(usage) ? row({ label: t("usage.today"), hint: esc(usageHint(usage, resetsIn(usage.resetsAt, usage.checkedAt))), nested: [field("usage")] }) : "",
    usage.people
      ? row({
          label: t("settings.sections.people"),
          hint: say("settings.sections.people.hint"),
          line: code(t("settings.sections.people.count", { total: usage.people.total, today: usage.people.today })),
        })
      : "",
  ]
}

function accountPage(account: Account, usage: SeenUsage | null, loginKey: string | null, a: Acts, hooks: { unlink: () => void; signOut: () => void; linkGithub: () => void }): string {
  const github = account.github
  const ghCode = !github ? account.githubCode : undefined
  const key = account.key
  const rows = [
    row({ label: t("settings.sections.name"), tip: t("settings.sections.name.tip"), line: esc(account.name) }),
    row({
      label: "GitHub",
      hint: account.githubSignIn ? say("settings.sections.github.sign.in") : github ? "" : say("settings.sections.github.why"),
      line: github
        ? [esc(`@${github.login}`), account.githubSignIn ? "" : a.act(t("settings.sections.github.unlink"), hooks.unlink)].filter(Boolean).join(" ")
        : main(a.act(t("settings.sections.github.link"), hooks.linkGithub)),
    }),
    ghCode
      ? row({
          label: t("settings.sections.github.code"),
          hint: say("settings.sections.github.code.hint"),
          line: `${a.chip(ghCode.code, () => void copyText(ghCode.code, t("settings.sections.github.code.copied")), t("settings.sections.github.code.copy"))} ${link(t("settings.sections.github.open"), ghCode.url)}`,
        })
      : "",
    key
      ? row({
          label: t("settings.sections.key"),
          hint: say("settings.sections.key.hint"),
          line: a.chip(key, () => void copyText(key, t("settings.sections.key.copied")), t("settings.sections.key.copy")),
        })
      : "",
    loginKey ? row({ label: t("settings.sections.login.key"), hint: say("settings.sections.login.key.hint"), line: code(loginKey) }) : "",
    ...usageRows(usage),
  ]
  return join([
    `# ${esc(t("settings.settings.account"))}`,
    rows.filter(Boolean).join("\n"),
    account.keysUnsealed ? note(esc(KEYS_UNSEALED)) : "",
    a.act(t("settings.sections.sign.out"), hooks.signOut),
  ])
}

export function AccountPage() {
  const { app } = useApp()
  const [leaving, setLeaving] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const usage = useUsage(app.actions.myUsage)
  const loginKey = useFingerprint(app.account?.personPk)
  const account = app.account
  if (!account) return null
  const { actions } = app
  const a = acts()
  const md = accountPage(account, usage, loginKey, a, { unlink: () => setUnlinking(true), signOut: () => setLeaving(true), linkGithub: actions.linkGithub })
  const near = usage ? levelOf(usage) !== "calm" : false
  return (
    <>
      <Sheet
        md={md}
        acts={a.acts}
        field={(name) =>
          name === "usage" && usage ? (
            <span className="set-usage">
              <span className={cx("set-value set-mono", near && "is-near")}>{usedOf(usage)}</span>
              <UsageBar usage={usage} />
            </span>
          ) : undefined
        }
      />
      {account.github && (
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
      )}
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

const layouts = () =>
  [
    ["side", t("settings.sections.layout.side")],
    ["top", t("settings.sections.layout.top")],
  ] as const satisfies readonly (readonly [Layout, string])[]

const motions = () =>
  [
    ["full", t("settings.sections.motion.full")],
    ["reduced", t("settings.sections.motion.reduced")],
  ] as const

function LanguageSelect() {
  const { pref } = useLanguage()
  return (
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
  )
}

const appearanceFields = (name: string): ReactNode | undefined =>
  name === "language" ? (
    <LanguageSelect />
  ) : name === "themes" ? (
    <Suspense fallback={null}>
      <Themes />
    </Suspense>
  ) : undefined

export function AppearancePage() {
  const { app } = useApp()
  const { prefs, actions } = app
  const layout = useLayout()
  const set = (p: Partial<Prefs>) => actions.setPrefs(p)
  const a = acts()
  const md = join([
    `# ${esc(t("settings.settings.appearance"))}`,
    say("settings.sections.appearance.lede"),
    [
      row({ label: t("settings.sections.mode"), nested: [choices(a, themes(), prefs.theme, (theme) => set({ theme }))] }),
      row({ label: t("settings.sections.text.size"), nested: [choices<number>(a, sizes(), prefs.textSize, (textSize) => set({ textSize }))] }),
      row({ label: t("settings.sections.font"), nested: [choices(a, fonts(), prefs.font, (font) => set({ font }))] }),
      row({ label: t("settings.sections.layout"), hint: say("settings.sections.layout.hint"), nested: [choices(a, layouts(), layout, setLayout)] }),
      row({ label: t("settings.sections.motion"), nested: [choices(a, motions(), prefs.reduceMotion ? "reduced" : "full", (m) => set({ reduceMotion: m === "reduced" }))] }),
      row({ label: t("settings.language"), nested: [field("language")] }),
    ].join("\n"),
    field("themes"),
  ])
  return <Sheet md={md} acts={a.acts} field={appearanceFields} />
}

function versionRow(account: Account, a: Acts, check: { busy: boolean; result: UpdateCheck | null; run: () => void; install: () => void }): string {
  const update = account.update
  const on = { version: account.version }
  if (update?.ready)
    return row({
      mark: "new",
      label: t("settings.sections.update.ready", { version: update.version }),
      hint: say("settings.sections.update.ready.hint", {}, on),
      line: main(a.act(t("settings.sections.update.restart"), check.install)),
    })
  if (update?.state === "available")
    return row({
      mark: "new",
      label: t("settings.sections.update.out", { version: update.version }),
      hint: update.blocked ? say("settings.sections.update.blocked") : say("settings.sections.update.on", {}, on),
      line: main(a.act(update.blocked ? t("settings.sections.update.get") : t("settings.sections.update.download"), check.install)),
    })
  if (update)
    return row({
      mark: "doing",
      label: t("settings.sections.update.downloading", { version: update.version }),
      tag: update.progress ? `${Math.round(update.progress * 100)}%` : "…",
      hint: say("settings.sections.update.keep.working"),
    })
  if (!account.desktop) return row({ mark: "fine", label: t("settings.sections.up.to.date"), hint: code(account.version) })
  const found = check.result ? esc(updateFound(check.result)) : ""
  return row({
    mark: "fine",
    label: t("settings.sections.up.to.date"),
    hint: check.busy ? say("settings.sections.checking") : check.result?.state === "failed" ? words(found, { tone: "alert" }) : found || code(account.version),
    line: a.act(t("settings.sections.check.now"), () => {
      if (!check.busy) check.run()
    }),
  })
}

function aboutPage(account: Account, a: Acts, debug: boolean, relayFailed: Failure | null, check: Parameters<typeof versionRow>[2]): string {
  const version = uiVersion()
  const relay = account.desktop
    ? row({
        label: t("settings.sections.relay"),
        hint: relayFailed ? words(esc(relayFailed.said), { tone: "alert" }) : say("settings.sections.relay.hint"),
        nested: [field("relay"), relayFailed?.raw ? field("relay-failed") : ""],
      })
    : row({ label: t("settings.sections.relay"), line: account.relay ? code(account.relay) : esc(t("settings.sections.relay.none")) })
  return join([
    `# ${esc(t("settings.settings.about"))}`,
    say("settings.sections.about.lede"),
    [
      versionRow(account, a, check),
      row({
        label: t("settings.sections.interface"),
        hint: say("settings.sections.interface.hint"),
        line: a.chip(version, () => void copyText(version, t("settings.sections.interface.copied")), t("settings.sections.interface.copy")),
      }),
      relay,
    ].join("\n"),
    toggle(
      debug,
      a.act(t("settings.sections.debug"), () => setDebugOptions(!debug)),
      say("settings.sections.debug.hint"),
      "*"
    ),
    fine(say("settings.sections.licenses")),
  ])
}

export function AboutPage() {
  const { app } = useApp()
  const debug = useDebugOptions()
  const [result, setResult] = useState<UpdateCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [relayFailed, setRelayFailed] = useState<Failure | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const account = app.account
  if (!account) return null
  const { actions } = app
  const relay = account.relay ?? ""
  const run = () => {
    setBusy(true)
    void actions
      .checkUpdate()
      .then(setResult, (err: unknown) => failedToast(t("settings.sections.check.failed"), err))
      .finally(() => setBusy(false))
  }
  const a = acts()
  const md = aboutPage(account, a, debug, relayFailed, { busy, result, run, install: actions.installUpdate })
  return (
    <>
      <Sheet
        md={md}
        acts={a.acts}
        field={(name) =>
          name === "relay" ? (
            <InlineEdit value={relay} label={t("settings.sections.relay")} verb={t("settings.sections.relay.change")} onSave={(url) => (url.trim() === relay ? undefined : setMoving(url))} />
          ) : name === "relay-failed" && relayFailed?.raw ? (
            <Details raw={relayFailed.raw} />
          ) : undefined
        }
      />
      <Confirm
        open={moving !== null}
        title={t("settings.sections.relay.change.ask", { relay: hostOf(moving ?? "") })}
        sub={t("settings.sections.relay.change.sub")}
        action={t("settings.sections.relay.change.yes")}
        onClose={() => setMoving(null)}
        onConfirm={() => {
          const url = moving
          setMoving(null)
          setRelayFailed(null)
          if (url) void actions.setRelay(url).catch((err: unknown) => setRelayFailed(failure(t("settings.sections.relay.failed"), err)))
        }}
      />
    </>
  )
}
