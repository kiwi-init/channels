import "~/i18n/en/settings"
import "~/styles/panes.css"
import "~/styles/settings.css"

import { ComputerIcon, SmartPhone01Icon } from "@hugeicons/core-free-icons"
import { lazy, Suspense, useMemo, type ReactNode } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { GlyphIcon, Icon } from "~/kit/icons"
import { withControls } from "~/panes/controls"
import { doOf, doUrl, NOTHING, pieces, type DoMore } from "~/panes/engine"

const Markdown = lazy(() => import("~/chat/markdown"))

const DO = "kiwi-do:"
const SPOT = ""
const PUNCT = /[!-/:-@[-`{-~]/g

type Vars = Readonly<Record<string, string | number>>

export const esc = (text: string): string => text.replace(/\s+/g, " ").trim().replace(PUNCT, "\\$&")

export function code(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const ticks = "`".repeat(Math.max(0, ...Array.from(flat.matchAll(/`+/g), (m) => m[0].length)) + 1)
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : ""
  return `${ticks}${pad}${flat}${pad}${ticks}`
}

export function say(key: Key, vars: Vars = {}, codes: Readonly<Record<string, string>> = {}): string {
  const names = Object.keys(codes)
  const spots = Object.fromEntries(names.map((name, i) => [name, `${SPOT}${i}${SPOT}`]))
  return esc(t(key, { ...vars, ...spots })).replace(new RegExp(`${SPOT}(\\d+)${SPOT}`, "g"), (_, i: string) => code(codes[names[Number(i)] ?? ""] ?? ""))
}

export const join = (parts: readonly string[]): string => parts.filter(Boolean).join("\n\n")
export const main = (act: string): string => (act ? `**${act}**` : "")
export const link = (label: string, url: string): string => `[${esc(label)}](<${url.replace(/[<>\s]/g, encodeURIComponent)}>)`
export const field = (name: string): string => ["```kiwi-field", name, "```"].join("\n")
export const fine = (text: string): string => (text ? `*${text}*` : "")
export const note = (text: string): string => `> [!WARNING]\n> ${text}`
export const words = (md: string, more: DoMore): string => `[${md}](${doUrl("", more)})`

export function card(parts: readonly string[]): string {
  return join(parts)
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
}

export interface ActMore extends DoMore {
  mark?: string
}

export interface Acts {
  acts: Map<string, () => void>
  act: (label: string, run: () => void, more?: ActMore) => string
  chip: (value: string, run: () => void, label?: string) => string
}

export function acts(): Acts {
  const acts = new Map<string, () => void>()
  const key = (run: () => void, more: DoMore = {}): string => {
    const id = `a${acts.size}`
    acts.set(id, run)
    return doUrl(id, more)
  }
  return {
    acts,
    act: (label, run, more = {}) => `[${more.mark ? `${code(more.mark)} ` : ""}${esc(label)}](${key(run, more)})`,
    chip: (value, run, label) => `[${code(value)}](${key(run, { label })})`,
  }
}

interface RowSpec {
  mark?: string
  label: string
  tip?: string
  tag?: string | undefined
  hint?: string
  line?: string
  nested?: readonly string[]
}

const indent = (block: string): string[] => block.split("\n").map((line) => (line ? `  ${line}` : ""))

export function row({ mark, label, tip, tag, hint, line, nested = [] }: RowSpec): string {
  const head = [mark ? code(mark) : "", `**${tip ? words(esc(label), { tip }) : esc(label)}**`, tag ? code(tag) : ""].filter(Boolean).join(" ")
  return [`- ${head}${hint ? ` · ${hint}` : ""}`, line ? `  ${line}` : "", ...nested.filter(Boolean).flatMap(indent)].filter(Boolean).join("\n")
}

export const toggle = (on: boolean, act: string, hint = "", bullet = "-"): string => `${bullet} [${on ? "x" : " "}] ${act}${hint ? ` · ${hint}` : ""}`

export function choices<T>(a: Acts, options: readonly (readonly [T, string])[], value: T, pick: (value: T) => void): string {
  return options
    .map(([v, text]) => {
      const act = a.act(text, () => pick(v))
      return `- ${v === value ? main(act) : act}`
    })
    .join("\n")
}

function common(name: string): ReactNode | undefined {
  switch (name) {
    case "computer":
      return <GlyphIcon glyph={ComputerIcon} />
    case "phone":
      return <GlyphIcon glyph={SmartPhone01Icon} />
    case "fine":
      return (
        <span className="tone-live">
          <Icon name="check" size={14} />
        </span>
      )
    case "new":
    case "doing":
    case "bad":
    case "online":
    case "offline":
    case "waiting":
      return <span className={`ctl-dot is-${name}`} />
  }
  return undefined
}

const NONE = (): undefined => undefined
const QUIET = () => {}

export function Sheet({
  md,
  acts,
  field = NONE,
  mark = NONE,
}: {
  md: string
  acts: ReadonlyMap<string, () => void>
  field?: (name: string) => ReactNode | undefined
  mark?: (name: string) => ReactNode | undefined
}) {
  const draw = useMemo(() => {
    const marks = (name: string): ReactNode | undefined => mark(name) ?? common(name)
    return withControls(pieces(NOTHING, marks), { field, mark: marks })
  }, [field, mark])
  const onPage = (url: string) => {
    const did = doOf(url)
    if (did.act) acts.get(did.url.slice(DO.length))?.()
  }
  return (
    <div className="ctl-page">
      <Suspense fallback={null}>
        <Markdown markdown={md} onMention={QUIET} onTask={QUIET} onMessage={QUIET} onImage={QUIET} onShown={QUIET} onPage={onPage} draw={draw} />
      </Suspense>
    </div>
  )
}
