import "~/i18n/en/settings"
import "~/styles/themes.css"

import { use, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

import { t } from "~/i18n/i18n"
import { Icon } from "~/kit/icons"
import type { Appearance, CustomTheme, ThemeBase } from "~/model"
import { useActions, useAppPrefs } from "~/nav"
import { Confirm, Seg } from "~/settings/controls"
import { setPreview, useSystemDark } from "~/theme/apply"
import { hex, isHex, TOKENS, type ColorTheme, type Colors } from "~/theme/derive"
import { loadRex } from "~/theme/rex"
import { allThemes, baseOf, customColors, resolveMode } from "~/theme/themes"

const SHOT = new URLSearchParams(location.search).get("shot")

const DOTS = ["c-red", "c-yellow", "c-green", "c-teal", "c-blue", "c-violet"] as const

const appearances = () =>
  [
    ["dark", t("settings.themes.dark")],
    ["light", t("settings.themes.light")],
  ] as const satisfies readonly (readonly [Appearance, string])[]

interface Draft {
  id: string | null
  name: string
  appearance: Appearance
  base: Required<ThemeBase>
}

const vars = (colors: Colors): CSSProperties => Object.fromEntries(TOKENS.map((t) => [`--${t}`, colors[t]])) as CSSProperties

function Mini({ colors }: { colors: Colors }) {
  return (
    <span className="theme-mini" style={vars(colors)} aria-hidden="true">
      <span className="theme-mini-rail">
        <i />
        <i />
      </span>
      <span className="theme-mini-side">
        <i className="is-on" />
        <i />
        <i />
      </span>
      <span className="theme-mini-main">
        <span className="theme-mini-text">
          <b />
          <i className="is-ink" />
        </span>
        <i className="theme-mini-line" />
        <span className="theme-mini-dots">
          {DOTS.map((d) => (
            <i key={d} style={{ background: `var(--${d})` }} />
          ))}
        </span>
      </span>
    </span>
  )
}

export function Themes() {
  const actions = useActions()
  const prefs = useAppPrefs()
  const systemDark = useSystemDark()
  const [query, setQuery] = useState("")
  const rex = use(loadRex())
  const themes = useMemo(() => allThemes(prefs.customThemes, rex), [prefs.customThemes, rex])
  const ref = useRef<HTMLElement>(null)
  const now = resolveMode(prefs.theme, systemDark)

  const draftFor = (appearance: Appearance): Draft | null => {
    const from = themes.find((t) => t.id === (appearance === "dark" ? prefs.darkTheme : prefs.lightTheme)) ?? themes.find((t) => t.appearance === appearance)
    return from ? { id: null, name: "", appearance, base: baseOf(from.colors) } : null
  }
  const [draft, setDraft] = useState<Draft | null>(() => (SHOT === "theme-editor" ? draftFor("dark") : null))
  const startNew = (appearance: Appearance) => {
    const next = draftFor(appearance)
    if (next) setDraft(next)
  }
  const startEdit = (t: CustomTheme) => setDraft({ id: t.id, name: t.name, appearance: t.appearance, base: { ...baseOf(customColors(t)), ...t.base } })

  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (SHOT === "settings-themes" || SHOT === "theme-editor") ref.current?.scrollIntoView({ block: "start" })
  })

  const q = query.trim().toLowerCase()
  return (
    <section className="theme" aria-label={t("settings.themes.theme")} ref={ref}>
      {draft ? (
        <Editor key={draft.id ?? "new"} start={draft} themes={themes} onDone={() => setDraft(null)} />
      ) : (
        <>
          <div className="theme-head">
            <h3 className="theme-title">{t("settings.themes.themes")}</h3>
            <label className="theme-search">
              <Icon name="search" size={14} />
              <input className="input" type="search" placeholder={t("settings.themes.search")} aria-label={t("settings.themes.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          {(["dark", "light"] as const).map((appearance) => {
            const chosen = appearance === "dark" ? prefs.darkTheme : prefs.lightTheme
            const list = themes.filter((t) => t.appearance === appearance && (!q || t.name.toLowerCase().includes(q)))
            const word = appearance === "dark" ? t("settings.themes.dark") : t("settings.themes.light")
            return (
              <div className="theme-group" key={appearance}>
                <div className="theme-group-head">
                  <h4>{word}</h4>
                  {now === appearance && <span className="theme-when">{t("settings.themes.in.use")}</span>}
                </div>
                <ul className="theme-grid">
                  {list.map((theme) => {
                    const mine = prefs.customThemes.find((c) => c.id === theme.id)
                    const on = chosen === theme.id
                    return (
                      <li key={theme.id} className="theme-card">
                        <button type="button" className="theme-pick" aria-pressed={on} onClick={() => actions.setPrefs(appearance === "dark" ? { darkTheme: theme.id } : { lightTheme: theme.id })}>
                          <span className="theme-frame">
                            <Mini colors={theme.colors} />
                          </span>
                          <span className="theme-name">{theme.name}</span>
                        </button>
                        {mine && (
                          <button type="button" className="btn is-quiet is-small theme-edit" aria-label={t("settings.themes.edit.named", { name: theme.name })} onClick={() => startEdit(mine)}>
                            {t("settings.themes.edit")}
                          </button>
                        )}
                      </li>
                    )
                  })}
                  <li className="theme-card">
                    <button type="button" className="theme-pick" onClick={() => startNew(appearance)}>
                      <span className="theme-frame is-new">
                        <Icon name="plus" size={18} />
                      </span>
                      <span className="theme-name">{t("settings.themes.new")}</span>
                    </button>
                  </li>
                </ul>
                {!list.length && <p className="theme-none">{t(appearance === "dark" ? "settings.themes.none.dark" : "settings.themes.none.light", { query: query.trim() })}</p>}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

function Editor({ start, themes, onDone }: { start: Draft; themes: ColorTheme[]; onDone: () => void }) {
  const actions = useActions()
  const [draft, setDraft] = useState(start)
  const [from, setFrom] = useState("")
  const [more, setMore] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const ref = useRef<HTMLFormElement>(null)
  const colors = useMemo(() => customColors(draft), [draft])

  useEffect(() => {
    setPreview({ id: "draft", name: draft.name, appearance: draft.appearance, colors })
  }, [colors, draft.name, draft.appearance])
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" })
    return () => setPreview(null)
  }, [])

  const setBase = (key: keyof ThemeBase, value: string) => setDraft((d) => ({ ...d, base: { ...d.base, [key]: value } }))
  const adjusted = colors.ink !== hex(draft.base.text) || colors.accent !== hex(draft.base.accent)
  const name = draft.name.trim()

  return (
    <form
      ref={ref}
      className="theme-editor"
      onSubmit={(e) => {
        e.preventDefault()
        actions.saveTheme({ id: draft.id ?? `mine-${Date.now().toString(36)}`, name: name || t("settings.themes.mine"), appearance: draft.appearance, base: draft.base })
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || deleting) return
        e.preventDefault()
        onDone()
      }}
    >
      <h3 className="theme-title">{draft.id ? t("settings.themes.edit.title") : t("settings.themes.new")}</h3>
      <div className="theme-form">
        <label className="theme-field">
          <span className="theme-label">{t("settings.themes.name")}</span>
          <input className="input" autoFocus value={draft.name} placeholder={t("settings.themes.mine")} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </label>
        <div className="theme-field">
          <span className="theme-label">{t("settings.themes.appearance")}</span>
          <Seg label={t("settings.themes.appearance")} value={draft.appearance} options={appearances()} onChange={(appearance) => setDraft((d) => ({ ...d, appearance }))} />
        </div>
        <label className="theme-field">
          <span className="theme-label">{t("settings.themes.start.from")}</span>
          <select
            className="input theme-select"
            value={from}
            onChange={(e) => {
              const t = themes.find((x) => x.id === e.target.value)
              setFrom(e.target.value)
              if (t) setDraft((d) => ({ ...d, appearance: t.appearance, base: baseOf(t.colors) }))
            }}
          >
            <option value="">{draft.id ? t("settings.themes.start.yours") : t("settings.themes.start.current")}</option>
            {(["dark", "light"] as const).map((a) => (
              <optgroup key={a} label={a === "dark" ? t("settings.themes.dark") : t("settings.themes.light")}>
                {themes
                  .filter((t) => t.appearance === a)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <div className="theme-colours">
        <Colour label={t("settings.themes.background")} value={draft.base.background} onChange={(v) => setBase("background", v)} />
        <Colour label={t("settings.themes.text")} value={draft.base.text} onChange={(v) => setBase("text", v)} />
        <Colour label={t("settings.themes.accent")} value={draft.base.accent} onChange={(v) => setBase("accent", v)} />
      </div>
      {adjusted && <p className="theme-note">{t("settings.themes.nudged")}</p>}
      <button type="button" className="btn is-quiet is-small theme-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
        <Icon name={more ? "down" : "chevron"} size={12} />
        {t("settings.themes.more")}
      </button>
      {more && (
        <>
          <div className="theme-colours">
            <Colour label={t("settings.themes.done")} value={draft.base.success} onChange={(v) => setBase("success", v)} />
            <Colour label={t("settings.themes.working")} value={draft.base.info} onChange={(v) => setBase("info", v)} />
            <Colour label={t("settings.themes.needs.you")} value={draft.base.warning} onChange={(v) => setBase("warning", v)} />
            <Colour label={t("settings.themes.failed")} value={draft.base.danger} onChange={(v) => setBase("danger", v)} />
          </div>
          <p className="theme-note">{t("settings.themes.members")}</p>
          <div className="theme-colours">
            <Colour label={t("settings.themes.red")} value={draft.base.red} onChange={(v) => setBase("red", v)} />
            <Colour label={t("settings.themes.yellow")} value={draft.base.yellow} onChange={(v) => setBase("yellow", v)} />
            <Colour label={t("settings.themes.green")} value={draft.base.green} onChange={(v) => setBase("green", v)} />
            <Colour label={t("settings.themes.cyan")} value={draft.base.cyan} onChange={(v) => setBase("cyan", v)} />
            <Colour label={t("settings.themes.blue")} value={draft.base.blue} onChange={(v) => setBase("blue", v)} />
            <Colour label={t("settings.themes.magenta")} value={draft.base.magenta} onChange={(v) => setBase("magenta", v)} />
          </div>
        </>
      )}
      <div className="theme-foot">
        {draft.id && (
          <button type="button" className="btn is-danger is-small" onClick={() => setDeleting(true)}>
            {t("settings.themes.delete")}
          </button>
        )}
        <span className="theme-foot-gap" />
        <button type="button" className="btn is-quiet" onClick={onDone}>
          {t("settings.controls.cancel")}
        </button>
        <button type="submit" className="btn is-primary">
          {t("settings.themes.save")}
        </button>
      </div>
      <Confirm
        open={deleting}
        title={t("settings.themes.delete.title")}
        sub={t("settings.themes.delete.sub")}
        action={t("settings.themes.delete")}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          if (draft.id) actions.deleteTheme(draft.id)
          onDone()
        }}
      />
    </form>
  )
}

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState<string | null>(null)
  return (
    <div className="theme-colour">
      <span className="theme-label">{label}</span>
      <span className="theme-colour-ctl">
        <input type="color" className="theme-swatch" aria-label={t("settings.themes.colour", { label })} value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          className="input is-mono theme-hex"
          aria-label={t("settings.themes.hex", { label })}
          spellCheck={false}
          maxLength={7}
          value={text ?? value}
          onChange={(e) => {
            const next = e.target.value.trim()
            setText(next)
            const full = next.startsWith("#") ? next : `#${next}`
            if (isHex(full)) onChange(full.toLowerCase())
          }}
          onBlur={() => setText(null)}
        />
      </span>
    </div>
  )
}
