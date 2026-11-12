import "~/i18n/en/settings"
import "~/styles/personalities.css"

import { Fragment, useEffect, useRef, useState } from "react"

import { copyOf, freeId } from "@kiwi/core/personalities.ts"
import { asksPeople, CAPABILITIES, MAX_AREA, MAX_AREAS, MAX_INSTRUCTIONS, MAX_NAME, ROLES, type Capability, type Personality, type Role } from "@kiwi/core/personality.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { useAppSince } from "~/settings/app-since"
import { Toggle } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { RoleFace } from "~/kit/role-face"
import { useApp } from "~/nav"
import { Confirm, Row, Seg } from "~/settings/controls"
import { DiscardAsk, useDiscard } from "~/kit/discard"

const TAGLINE: Record<string, Key> = {
  builder: "settings.personalities.tagline.builder",
  reviewer: "settings.personalities.tagline.reviewer",
  "bug-hunter": "settings.personalities.tagline.bug.hunter",
  explorer: "settings.personalities.tagline.explorer",
  releaser: "settings.personalities.tagline.releaser",
  lead: "settings.personalities.tagline.lead",
}

const CAPABILITY_TEXT: Record<Capability, readonly [Key, Key]> = {
  write: ["settings.personalities.can.write", "settings.personalities.can.write.hint"],
  tasks: ["settings.personalities.can.tasks", "settings.personalities.can.tasks.hint"],
  prs: ["settings.personalities.can.prs", "settings.personalities.can.prs.hint"],
  merge: ["settings.personalities.can.merge", "settings.personalities.can.merge.hint"],
  review: ["settings.personalities.can.review", "settings.personalities.can.review.hint"],
  release: ["settings.personalities.can.release", "settings.personalities.can.release.hint"],
  assign: ["settings.personalities.can.assign", "settings.personalities.can.assign.hint"],
  notes: ["settings.personalities.can.notes", "settings.personalities.can.notes.hint"],
}

const ROLE_LABEL: Record<Role, Key> = {
  builder: "settings.personalities.role.builder",
  reviewer: "settings.personalities.role.reviewer",
  "bug-hunter": "settings.personalities.role.bug.hunter",
  explorer: "settings.personalities.role.explorer",
  releaser: "settings.personalities.role.releaser",
  lead: "settings.personalities.role.lead",
}

const roleOptions = (): readonly (readonly [Role, string])[] => ROLES.map((r) => [r, t(ROLE_LABEL[r])] as const)

const BLANK: Omit<Personality, "id" | "name"> = { glyph: "✳", role: "builder", capabilities: ["write", "tasks", "notes"], areas: [], instructions: "" }

const ASK_PEOPLE_SINCE = "3.6.0"

const SHOT = new URLSearchParams(location.search).get("shot")

function tagline(p: Personality): string {
  const own = TAGLINE[p.id]
  if (own) return t(own)
  return p.areas.length ? t("settings.personalities.tagline.limited", { role: t(ROLE_LABEL[p.role]), areas: p.areas.join(", ") }) : t(ROLE_LABEL[p.role])
}

export function Personalities() {
  const { app } = useApp()
  const own = app.ownPersonalities
  const taken = new Set([...PRESETS, ...own].map((p) => p.id))
  const copy = (p: Personality): Personality => ({ ...copyOf(p, taken), name: t("settings.personalities.yours", { name: p.name }).slice(0, MAX_NAME) })
  const [draft, setDraft] = useState<Personality | null>(() => (SHOT === "personality-editor" && PRESETS[0] ? copy(PRESETS[0]) : null))

  if (draft) return <Editor key={draft.id} start={draft} isNew={!own.some((p) => p.id === draft.id)} onDone={() => setDraft(null)} />
  return (
    <section className="set-group" aria-label={t("settings.personalities.title")}>
      <div className="heading">
        <h3>{t("settings.personalities.title")}</h3>
      </div>
      <ul className="persona-cards">
        {PRESETS.map((p) => (
          <Card key={p.id} p={p} preset onOpen={() => setDraft(copy(p))} />
        ))}
        {own.map((p) => (
          <Card key={p.id} p={p} preset={false} onOpen={() => setDraft(p)} />
        ))}
        <li>
          <button
            type="button"
            className="persona-card is-new"
            onClick={() => {
              const name = t("settings.personalities.new")
              setDraft({ ...BLANK, name, id: freeId(name, taken) })
            }}
          >
            <span className="persona-card-face">
              <Icon name="plus" size={16} />
            </span>
            <span className="persona-card-name">{t("settings.personalities.new")}</span>
          </button>
        </li>
      </ul>
    </section>
  )
}

function Card({ p, preset, onOpen }: { p: Personality; preset: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="persona-card" aria-label={t(preset ? "settings.personalities.copy.named" : "settings.personalities.edit.named", { name: p.name })} onClick={onOpen}>
        <span className="persona-card-face" aria-hidden="true">
          <RoleFace role={p.role} />
        </span>
        <span className="persona-card-text">
          <span className="persona-card-name">
            {!preset && (
              <span className="persona-glyph" aria-hidden="true">
                {p.glyph}
              </span>
            )}
            {p.name}
          </span>
          <span className="persona-card-line">{tagline(p)}</span>
        </span>
        <span className="persona-card-verb" aria-hidden="true">
          {t(preset ? "settings.personalities.copy" : "settings.personalities.edit")}
        </span>
      </button>
    </li>
  )
}

function Editor({ start, isNew, onDone }: { start: Personality; isNew: boolean; onDone: () => void }) {
  const { app } = useApp()
  const [draft, setDraft] = useState(start)
  const [area, setArea] = useState("")
  const [deleting, setDeleting] = useState(false)
  const ref = useRef<HTMLFormElement>(null)
  const discard = useDiscard(JSON.stringify(draft) !== JSON.stringify(start) || !!area.trim(), onDone)
  const own = app.ownPersonalities
  const keepsAsk = useAppSince(ASK_PEOPLE_SINCE)
  const set = (patch: Partial<Personality>) => setDraft((d) => ({ ...d, ...patch }))
  const toggle = (c: Capability) => set({ capabilities: CAPABILITIES.filter((x) => (x === c ? !draft.capabilities.includes(c) : draft.capabilities.includes(x))) })
  const addArea = () => {
    const a = area.trim()
    if (!a || draft.areas.includes(a) || draft.areas.length >= MAX_AREAS) return
    setArea("")
    set({ areas: [...draft.areas, a] })
  }

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" })
  }, [])

  return (
    <form
      ref={ref}
      className="persona-editor"
      aria-label={isNew ? t("settings.personalities.new") : t("settings.personalities.edit.named", { name: start.name })}
      onSubmit={(e) => {
        e.preventDefault()
        const glyph = [...draft.glyph.trim()].length === 1 ? draft.glyph.trim() : start.glyph
        const next = { ...draft, name: draft.name.trim() || start.name, glyph }
        app.actions.savePersonalities(isNew ? [...own, next] : own.map((p) => (p.id === next.id ? next : p)))
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || deleting) return
        e.preventDefault()
        discard.leave()
      }}
    >
      <h3 className="persona-title">{isNew ? t("settings.personalities.new") : t("settings.personalities.edit.title")}</h3>
      <div className="persona-form">
        <label className="persona-field is-glyph">
          <span className="persona-label">{t("settings.personalities.glyph")}</span>
          <input className="input" value={draft.glyph} onChange={(e) => set({ glyph: e.target.value })} />
        </label>
        <label className="persona-field">
          <span className="persona-label">{t("settings.personalities.name")}</span>
          <input className="input" autoFocus value={draft.name} maxLength={MAX_NAME} onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>
      <div className="persona-field">
        <span className="persona-label">{t("settings.personalities.role")}</span>
        <Seg label={t("settings.personalities.role")} value={draft.role} options={roleOptions()} onChange={(role) => set({ role })} />
      </div>
      <div className="persona-field">
        <span className="persona-label">{t("settings.personalities.capabilities")}</span>
        <div className="set-rows">
          {CAPABILITIES.map((c) => (
            <Fragment key={c}>
              <Row label={t(CAPABILITY_TEXT[c][0])} hint={t(CAPABILITY_TEXT[c][1])}>
                <Toggle label={t(CAPABILITY_TEXT[c][0])} on={draft.capabilities.includes(c)} onChange={() => toggle(c)} />
              </Row>
              {c === "write" && (
                <Row label={t("settings.personalities.can.ask.people")} hint={t(keepsAsk ? "settings.personalities.can.ask.people.hint" : "settings.personalities.can.ask.people.update")}>
                  <Toggle
                    label={t("settings.personalities.can.ask.people")}
                    on={asksPeople(draft)}
                    disabled={!keepsAsk || !draft.capabilities.includes("write")}
                    why={keepsAsk ? undefined : t("settings.personalities.can.ask.people.update")}
                    onChange={(on) => set({ askPeople: on })}
                  />
                </Row>
              )}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="persona-field">
        <span className="persona-label">{t("settings.personalities.areas")}</span>
        <div className="persona-areas">
          {draft.areas.length === 0 && <span className="persona-area is-any">{t("settings.personalities.anywhere")}</span>}
          {draft.areas.map((a) => (
            <button key={a} type="button" className="persona-area" aria-label={t("settings.personalities.area.remove", { area: a })} onClick={() => set({ areas: draft.areas.filter((x) => x !== a) })}>
              {a}
              <Icon name="close" size={12} />
            </button>
          ))}
          <input
            className="input persona-area-add"
            aria-label={t("settings.personalities.area.add")}
            placeholder={t("settings.personalities.area.placeholder")}
            value={area}
            maxLength={MAX_AREA}
            onChange={(e) => setArea(e.target.value)}
            onBlur={addArea}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              e.preventDefault()
              addArea()
            }}
          />
        </div>
      </div>
      <label className="persona-field">
        <span className="persona-label">{t("settings.personalities.instructions")}</span>
        <textarea
          className="textarea persona-instructions"
          placeholder={t("settings.personalities.instructions.placeholder")}
          value={draft.instructions}
          maxLength={MAX_INSTRUCTIONS}
          onChange={(e) => set({ instructions: e.target.value })}
        />
      </label>
      <div className="persona-foot">
        {!isNew && (
          <button type="button" className="btn is-danger is-small" onClick={() => setDeleting(true)}>
            {t("settings.personalities.delete")}
          </button>
        )}
        <span className="persona-foot-gap" />
        {discard.asking && <DiscardAsk onKeep={discard.keep} onDiscard={onDone} />}
        <button type="button" className="btn is-quiet" onClick={onDone}>
          {t("settings.controls.cancel")}
        </button>
        <button type="submit" className="btn is-primary">
          {t("settings.personalities.save")}
        </button>
      </div>
      <Confirm
        open={deleting}
        title={t("settings.personalities.delete.title")}
        sub={t("settings.personalities.delete.sub")}
        action={t("settings.personalities.delete")}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          app.actions.savePersonalities(own.filter((p) => p.id !== start.id))
          onDone()
        }}
      />
    </form>
  )
}
