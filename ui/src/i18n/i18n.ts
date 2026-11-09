import { useSyncExternalStore } from "react"

import { en, type Key, type Msg } from "~/i18n/en"

export const LANGS = ["en", "pt-BR", "ja", "ko", "zh-CN"] as const
export type Lang = (typeof LANGS)[number]
export type LangPref = "system" | Lang
export type Catalog = { readonly [K in Key]?: Msg }
type Vars = Readonly<Record<string, string | number>>

export const LANG_NAMES: Record<Lang, string> = { en: "English", "pt-BR": "Português (Brasil)", ja: "日本語", ko: "한국어", "zh-CN": "简体中文" }

export const CATALOGS: Record<Exclude<Lang, "en">, () => Promise<{ default: Catalog }>> = {
  "pt-BR": () => import("~/i18n/pt-BR"),
  ja: () => import("~/i18n/ja"),
  ko: () => import("~/i18n/ko"),
  "zh-CN": () => import("~/i18n/zh-CN"),
}

const KEY = "ui.language"
const listeners = new Set<() => void>()
let shown: { pref: LangPref; lang: Lang } = { pref: "system", lang: "en" }
let catalog: Catalog = en
let asked = 0
const later = new Map<string, Msg>()

export function addWords(words: Readonly<Record<string, Msg>>): void {
  for (const [key, msg] of Object.entries(words)) later.set(key, msg)
}

export function langOf(tags: readonly string[]): Lang {
  for (const tag of tags) {
    const t = tag.toLowerCase()
    if (t === "en" || t.startsWith("en-")) return "en"
    if (t === "pt" || t.startsWith("pt-")) return "pt-BR"
    if (t === "ja" || t.startsWith("ja-")) return "ja"
    if (t === "ko" || t.startsWith("ko-")) return "ko"
    if (t === "zh" || t.startsWith("zh-")) return "zh-CN"
  }
  return "en"
}

const isLang = (v: unknown): v is Lang => typeof v === "string" && (LANGS as readonly string[]).includes(v)

function storedPref(): LangPref {
  try {
    const v = localStorage.getItem(KEY)
    return isLang(v) ? v : "system"
  } catch {
    return "system"
  }
}

const systemLang = (): Lang => langOf(typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language])
const resolve = (pref: LangPref): Lang => (pref === "system" ? systemLang() : pref)

async function show(pref: LangPref): Promise<void> {
  const ask = ++asked
  const lang = resolve(pref)
  const next = lang === "en" ? en : (await CATALOGS[lang]()).default
  if (ask !== asked) return
  catalog = next
  shown = { pref, lang }
  if (typeof document !== "undefined") document.documentElement.lang = lang
  for (const l of listeners) l()
}

export function startLanguage(): Promise<void> {
  if (typeof window !== "undefined")
    window.addEventListener("languagechange", () => {
      if (shown.pref === "system") void show("system").catch(() => undefined)
    })
  return show(storedPref()).catch(() => {
    // A catalog that fails to load leaves the app in English, which every key has.
  })
}

export function setLanguage(pref: LangPref): void {
  try {
    if (pref === "system") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
  void show(pref).catch(() => {
    // The catalog didn't load: the app stays in the language it shows.
  })
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useLanguage = (): { pref: LangPref; lang: Lang } => useSyncExternalStore(subscribe, () => shown)

const formats = new Map<string, Intl.NumberFormat>()
const rules = new Map<Lang, Intl.PluralRules>()

function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${shown.lang}:${JSON.stringify(options)}`
  let f = formats.get(key)
  if (!f) formats.set(key, (f = new Intl.NumberFormat(shown.lang, options)))
  return f
}

const num = (n: number): string => numberFormat().format(n)

export const span = (n: number, unit: "minute" | "hour"): string => numberFormat({ style: "unit", unit, unitDisplay: "narrow" }).format(n)

function plural(lang: Lang, n: number): Intl.LDMLPluralRule {
  let r = rules.get(lang)
  if (!r) rules.set(lang, (r = new Intl.PluralRules(lang)))
  return r.select(n)
}

function textOf(msg: Msg, lang: Lang, count: unknown): string {
  if (typeof msg === "string") return msg
  const forms: Partial<Record<Intl.LDMLPluralRule, string>> = msg
  return forms[plural(lang, Number(count ?? 0))] ?? msg.other
}

const fill = (text: string, vars: Vars): string =>
  text.replace(/\{(\w+)\}/g, (all: string, name: string) => (vars[name] === undefined ? all : typeof vars[name] === "number" ? num(vars[name]) : vars[name]))

export function t(key: Key, vars?: Vars): string {
  const own = catalog[key]
  const text = own === undefined ? textOf((en as Readonly<Record<string, Msg>>)[key] ?? later.get(key) ?? key, "en", vars?.count) : textOf(own, shown.lang, vars?.count)
  return vars ? fill(text, vars) : text
}
