import "~/styles/themes.css"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"

import { cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Appearance, CustomTheme, ThemeBase } from "~/model"
import { useApp } from "~/nav"
import { Confirm, Seg } from "~/settings/controls"
import { setPreview, useSystemDark } from "~/theme/apply"
import { hex, isHex, TOKENS, type ColorTheme, type Colors } from "~/theme/derive"
import { allThemes, baseOf, customColors, resolveMode } from "~/theme/themes"

const SHOT = new URLSearchParams(location.search).get("shot")

const DOTS = ["c-red", "c-yellow", "c-green", "c-teal", "c-blue", "c-violet"] as const

const APPEARANCES = [
  ["dark", "Dark"],
  ["light", "Light"],
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
  const { app } = useApp()
  const { prefs, actions } = app
  const systemDark = useSystemDark()
  const [query, setQuery] = useState("")
  const themes = useMemo(() => allThemes(prefs.customThemes), [prefs.customThemes])
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
    <section className="theme" aria-label="Theme" ref={ref}>
      {draft ? (
        <Editor key={draft.id ?? "new"} start={draft} themes={themes} onDone={() => setDraft(null)} />
      ) : (
        <>
          <div className="theme-head">
            <div className="theme-head-text">
              <h3 className="theme-title">Theme</h3>
              <p className="theme-hint">Pick one dark and one light theme. The mode decides which one shows.</p>
            </div>
            <label className="theme-search">
              <Icon name="search" size={14} />
              <input className="input" type="search" placeholder="Search themes" aria-label="Search themes" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          {(["dark", "light"] as const).map((appearance) => {
            const chosen = appearance === "dark" ? prefs.darkTheme : prefs.lightTheme
            const list = themes.filter((t) => t.appearance === appearance && (!q || t.name.toLowerCase().includes(q)))
            const word = appearance === "dark" ? "Dark" : "Light"
            return (
              <div className="theme-group" key={appearance}>
                <div className="theme-group-head">
                  <h4>{word}</h4>
                  <span className={cx("theme-when", now === appearance && "is-now")}>
                    {now === appearance ? "In use" : prefs.theme === "system" ? `When your computer is in ${appearance} mode` : `When the mode is ${word}`}
                  </span>
                </div>
                <ul className="theme-grid">
                  {list.map((t) => {
                    const mine = prefs.customThemes.find((c) => c.id === t.id)
                    const on = chosen === t.id
                    return (
                      <li key={t.id} className="theme-card">
                        <button type="button" className="theme-pick" aria-pressed={on} onClick={() => actions.setPrefs(appearance === "dark" ? { darkTheme: t.id } : { lightTheme: t.id })}>
                          <span className="theme-frame">
                            <Mini colors={t.colors} />
                          </span>
                          <span className="theme-name">{t.name}</span>
                        </button>
                        {mine && (
                          <button type="button" className="btn is-quiet is-small theme-edit" aria-label={`Edit ${t.name}`} onClick={() => startEdit(mine)}>
                            Edit
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
                      <span className="theme-name">New theme</span>
                    </button>
                  </li>
                </ul>
                {!list.length && (
                  <p className="theme-none">
                    No {appearance} themes match “{query.trim()}”.
                  </p>
                )}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

function Editor({ start, themes, onDone }: { start: Draft; themes: ColorTheme[]; onDone: () => void }) {
  const { app } = useApp()
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
        app.actions.saveTheme({ id: draft.id ?? `mine-${Date.now().toString(36)}`, name: name || "My theme", appearance: draft.appearance, base: draft.base })
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || deleting) return
        e.preventDefault()
        onDone()
      }}
    >
      <div className="theme-head">
        <div className="theme-head-text">
          <h3 className="theme-title">{draft.id ? "Edit theme" : "New theme"}</h3>
          <p className="theme-hint">The whole app shows it while you edit. Everything else follows from these colours.</p>
        </div>
      </div>
      <div className="theme-form">
        <label className="theme-field">
          <span className="theme-label">Name</span>
          <input className="input" autoFocus value={draft.name} placeholder="My theme" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </label>
        <div className="theme-field">
          <span className="theme-label">Appearance</span>
          <Seg label="Appearance" value={draft.appearance} options={APPEARANCES} onChange={(appearance) => setDraft((d) => ({ ...d, appearance }))} />
        </div>
        <label className="theme-field">
          <span className="theme-label">Start from</span>
          <select
            className="input theme-select"
            value={from}
            onChange={(e) => {
              const t = themes.find((x) => x.id === e.target.value)
              setFrom(e.target.value)
              if (t) setDraft((d) => ({ ...d, appearance: t.appearance, base: baseOf(t.colors) }))
            }}
          >
            <option value="">{draft.id ? "Your colours" : "The theme you use now"}</option>
            {(["dark", "light"] as const).map((a) => (
              <optgroup key={a} label={a === "dark" ? "Dark" : "Light"}>
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
        <Colour label="Background" value={draft.base.background} onChange={(v) => setBase("background", v)} />
        <Colour label="Text" value={draft.base.text} onChange={(v) => setBase("text", v)} />
        <Colour label="Accent" value={draft.base.accent} onChange={(v) => setBase("accent", v)} />
      </div>
      {adjusted && <p className="theme-note">Text or accent is a little lighter or darker than picked, so it stays readable.</p>}
      <button type="button" className="btn is-quiet is-small theme-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
        <Icon name={more ? "down" : "chevron"} size={12} />
        More colours
      </button>
      {more && (
        <>
          <div className="theme-colours">
            <Colour label="Done" value={draft.base.success} onChange={(v) => setBase("success", v)} />
            <Colour label="Working" value={draft.base.info} onChange={(v) => setBase("info", v)} />
            <Colour label="Needs you" value={draft.base.warning} onChange={(v) => setBase("warning", v)} />
            <Colour label="Failed" value={draft.base.danger} onChange={(v) => setBase("danger", v)} />
          </div>
          <p className="theme-note">People get these colours. Magenta also marks work in review.</p>
          <div className="theme-colours">
            <Colour label="Red" value={draft.base.red} onChange={(v) => setBase("red", v)} />
            <Colour label="Yellow" value={draft.base.yellow} onChange={(v) => setBase("yellow", v)} />
            <Colour label="Green" value={draft.base.green} onChange={(v) => setBase("green", v)} />
            <Colour label="Cyan" value={draft.base.cyan} onChange={(v) => setBase("cyan", v)} />
            <Colour label="Blue" value={draft.base.blue} onChange={(v) => setBase("blue", v)} />
            <Colour label="Magenta" value={draft.base.magenta} onChange={(v) => setBase("magenta", v)} />
          </div>
        </>
      )}
      <div className="theme-foot">
        {draft.id && (
          <button type="button" className="btn is-danger is-small" onClick={() => setDeleting(true)}>
            Delete theme
          </button>
        )}
        <span className="theme-foot-gap" />
        <button type="button" className="btn is-quiet" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn is-primary">
          Save theme
        </button>
      </div>
      <Confirm
        open={deleting}
        title="Delete this theme?"
        sub="It goes away on this computer. If it's in use, Channels Dark or Channels Light takes its place."
        action="Delete theme"
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          if (draft.id) app.actions.deleteTheme(draft.id)
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
        <input type="color" className="theme-swatch" aria-label={`${label} colour`} value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          className="input is-mono theme-hex"
          aria-label={`${label} hex`}
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
